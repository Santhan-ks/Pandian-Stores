CREATE TABLE nova.sales_orders (
 id text PRIMARY KEY, customer_id text NOT NULL REFERENCES nova.customers(id), salesman_id text NOT NULL REFERENCES nova.users(id),
 request_key text NOT NULL UNIQUE, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','approved','rejected','invoiced','dispatched','cancelled')), reason text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE nova.sales_order_lines (
 id text PRIMARY KEY, order_id text NOT NULL REFERENCES nova.sales_orders(id), product_id text NOT NULL REFERENCES nova.products(id),
 quantity numeric NOT NULL CHECK(quantity>0 AND quantity=trunc(quantity)), rate numeric(20,2) NOT NULL CHECK(rate>0), gst_percent numeric NOT NULL CHECK(gst_percent BETWEEN 0 AND 100), UNIQUE(order_id,product_id)
);
CREATE TABLE nova.invoice_sequences (financial_year text PRIMARY KEY, last_number integer NOT NULL CHECK(last_number>0));
CREATE TABLE nova.invoices (
 id text PRIMARY KEY, order_id text NOT NULL UNIQUE REFERENCES nova.sales_orders(id), number text NOT NULL UNIQUE, financial_year text NOT NULL,
 invoice_date date NOT NULL, snapshot jsonb NOT NULL, total numeric(20,2) NOT NULL CHECK(total>0), created_by text NOT NULL REFERENCES nova.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE nova.dispatches (id text PRIMARY KEY REFERENCES nova.stock_documents(id), invoice_id text NOT NULL UNIQUE REFERENCES nova.invoices(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE nova.payments (
 id text PRIMARY KEY, customer_id text NOT NULL REFERENCES nova.customers(id), payment_date date NOT NULL, reference text NOT NULL, method text NOT NULL CHECK(method IN ('cash','bank','upi','cheque')),
 amount numeric(20,2) NOT NULL CHECK(amount>0), request_key text NOT NULL UNIQUE, payload jsonb NOT NULL, actor_id text NOT NULL REFERENCES nova.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE nova.payment_allocations (payment_id text NOT NULL REFERENCES nova.payments(id), invoice_id text NOT NULL REFERENCES nova.invoices(id), amount numeric(20,2) NOT NULL CHECK(amount>0), PRIMARY KEY(payment_id,invoice_id));
CREATE TABLE nova.credit_notes (id text PRIMARY KEY, invoice_id text NOT NULL UNIQUE REFERENCES nova.invoices(id), reason text NOT NULL CHECK(length(trim(reason))>2), amount numeric(20,2) NOT NULL CHECK(amount>0), actor_id text NOT NULL REFERENCES nova.users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX sales_customer ON nova.sales_orders(customer_id);
CREATE INDEX sales_salesman ON nova.sales_orders(salesman_id);
CREATE VIEW nova.invoice_balances AS SELECT i.id,i.total,i.total-coalesce((SELECT sum(a.amount) FROM nova.payment_allocations a WHERE a.invoice_id=i.id),0)-coalesce((SELECT sum(c.amount) FROM nova.credit_notes c WHERE c.invoice_id=i.id),0) AS outstanding FROM nova.invoices i;
CREATE FUNCTION nova.immutable_financial() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Financial records are immutable'; END $$;
CREATE TRIGGER invoice_guard BEFORE UPDATE OR DELETE ON nova.invoices FOR EACH ROW EXECUTE FUNCTION nova.immutable_financial();
CREATE TRIGGER payment_guard BEFORE UPDATE OR DELETE ON nova.payments FOR EACH ROW EXECUTE FUNCTION nova.immutable_financial();
CREATE TRIGGER allocation_guard BEFORE UPDATE OR DELETE ON nova.payment_allocations FOR EACH ROW EXECUTE FUNCTION nova.immutable_financial();
CREATE TRIGGER credit_guard BEFORE UPDATE OR DELETE ON nova.credit_notes FOR EACH ROW EXECUTE FUNCTION nova.immutable_financial();
CREATE TRIGGER dispatch_guard BEFORE UPDATE OR DELETE ON nova.dispatches FOR EACH ROW EXECUTE FUNCTION nova.immutable_financial();
CREATE FUNCTION nova.guard_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='sales_order_lines' THEN
  PERFORM 1 FROM nova.sales_orders WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END AND status='submitted' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order lines are frozen after approval'; END IF;
 ELSE
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Orders cannot be deleted'; END IF;
  IF OLD.status<>'submitted' AND (to_jsonb(NEW)-'status'-'reason') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'reason') THEN RAISE EXCEPTION 'Approved details are immutable'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER order_guard BEFORE UPDATE OR DELETE ON nova.sales_orders FOR EACH ROW EXECUTE FUNCTION nova.guard_order();
CREATE TRIGGER order_line_guard BEFORE INSERT OR UPDATE OR DELETE ON nova.sales_order_lines FOR EACH ROW EXECUTE FUNCTION nova.guard_order();
ALTER TABLE nova.stock_documents DROP CONSTRAINT stock_documents_category_check;
ALTER TABLE nova.stock_documents ADD CONSTRAINT stock_documents_category_check CHECK(category IN ('opening','purchase','adjustment','production','dispatch'));
CREATE OR REPLACE FUNCTION nova.post_stock_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line record; balance record; delta numeric; movement_value numeric; factor numeric; base_factor numeric; dimension text; base_dimension text; item_unit text; item_kind text;
BEGIN
 IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM nova.user_roles WHERE user_id=NEW.posted_by AND (role='admin' OR (role='production' AND NEW.category IN ('purchase','production')))) THEN RAISE EXCEPTION 'Unauthorized posting'; END IF;
 IF NOT EXISTS(SELECT 1 FROM nova.stock_document_lines WHERE document_id=NEW.id) THEN RAISE EXCEPTION 'Document requires lines'; END IF;
 PERFORM i.id FROM nova.inventory_items i JOIN nova.stock_document_lines l ON l.item_id=i.id WHERE l.document_id=NEW.id ORDER BY i.id FOR UPDATE OF i;
 FOR line IN SELECT * FROM nova.stock_document_lines WHERE document_id=NEW.id ORDER BY CASE WHEN NEW.category='production' AND quantity>0 THEN 1 ELSE 0 END,item_id LOOP
   SELECT base_unit,kind INTO item_unit,item_kind FROM nova.inventory_items WHERE id=line.item_id;
   SELECT u.dimension,u.base_factor INTO dimension,factor FROM nova.units u WHERE code=line.unit;
   SELECT u.dimension,u.base_factor INTO base_dimension,base_factor FROM nova.units u WHERE code=item_unit;
   IF dimension<>base_dimension THEN RAISE EXCEPTION 'Incompatible units'; END IF;
   IF NEW.category NOT IN ('adjustment','production','dispatch') AND line.quantity<=0 THEN RAISE EXCEPTION 'Receipt must be positive'; END IF;
   IF NEW.category='purchase' AND (line.unit_rate IS NULL OR item_kind='finished') THEN RAISE EXCEPTION 'Purchases require a material and rate'; END IF;
   IF NEW.category='opening' AND EXISTS(SELECT 1 FROM nova.inventory_movements WHERE item_id=line.item_id) THEN RAISE EXCEPTION 'Opening requires an item with no movement history'; END IF;
   SELECT quantity,value INTO balance FROM nova.stock_summary WHERE id=line.item_id;
   delta := line.quantity*factor/base_factor;
   IF item_unit IN ('piece','packet') AND delta<>trunc(delta) THEN RAISE EXCEPTION 'Count units must be whole'; END IF;
   IF balance.quantity+delta<0 THEN RAISE EXCEPTION 'Insufficient stock'; END IF;
   IF NEW.category='dispatch' THEN
     IF item_kind<>'finished' OR delta>=0 OR NOT EXISTS(SELECT 1 FROM nova.dispatches WHERE id=NEW.id) THEN RAISE EXCEPTION 'Invalid dispatch'; END IF;
     movement_value := delta*balance.value/nullif(balance.quantity,0);
   ELSIF NEW.category='production' THEN
     IF NOT EXISTS(SELECT 1 FROM nova.production_runs WHERE id=NEW.id) THEN RAISE EXCEPTION 'Missing production run'; END IF;
     IF delta<0 THEN
       IF item_kind='finished' THEN RAISE EXCEPTION 'Invalid production input'; END IF;
       movement_value := delta*balance.value/nullif(balance.quantity,0);
     ELSE
       IF NOT EXISTS(SELECT 1 FROM nova.production_runs r JOIN nova.products p ON p.id=r.product_id WHERE r.id=NEW.id AND p.item_id=line.item_id AND r.good_output=delta) THEN RAISE EXCEPTION 'Invalid production output'; END IF;
       SELECT CASE WHEN count(*) FILTER(WHERE value IS NULL)>0 THEN NULL ELSE -sum(value) END INTO movement_value FROM nova.inventory_movements WHERE document_id=NEW.id AND quantity<0;
     END IF;
   ELSIF NEW.category='adjustment' THEN
     IF line.unit_rate IS NOT NULL THEN RAISE EXCEPTION 'Adjustments use existing average valuation'; END IF;
     movement_value := CASE WHEN balance.quantity=0 THEN NULL ELSE delta*balance.value/balance.quantity END;
   ELSE movement_value := line.quantity*line.unit_rate;
   END IF;
   INSERT INTO nova.inventory_movements(id,document_id,line_id,item_id,quantity,base_unit,value,quantity_before,quantity_after,actor_id)
     VALUES(line.id,NEW.id,line.id,line.item_id,delta,item_unit,movement_value,balance.quantity,balance.quantity+delta,NEW.posted_by);
 END LOOP;
 IF NEW.category='production' THEN
   INSERT INTO nova.production_cost_snapshots(run_id,material_cost,inputs) SELECT NEW.id,CASE WHEN count(*) FILTER(WHERE m.value IS NULL)>0 THEN NULL ELSE -sum(m.value) END,jsonb_agg(jsonb_build_object('itemId',m.item_id,'quantity',-m.quantity,'baseUnit',m.base_unit,'cost',-m.value)) FROM nova.inventory_movements m WHERE m.document_id=NEW.id AND m.quantity<0;
 END IF;
 INSERT INTO nova.audit_events(id,actor_id,action,document_id,before,after) VALUES(NEW.id||'-post',NEW.posted_by,'stock.post',NEW.id,to_jsonb(OLD),to_jsonb(NEW));
 RETURN NEW;
END $$;
