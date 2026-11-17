CREATE FUNCTION nova.check_payment_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE paid nova.payments; allocated numeric; invoice_customer text; remaining numeric;
BEGIN
 IF TG_TABLE_NAME='payments' THEN
  SELECT * INTO paid FROM nova.payments WHERE id=NEW.id;
  SELECT coalesce(sum(amount),0) INTO allocated FROM nova.payment_allocations WHERE payment_id=paid.id;
  IF allocated<>paid.amount THEN RAISE EXCEPTION 'Payment must be fully allocated'; END IF;
 ELSE
  SELECT * INTO paid FROM nova.payments WHERE id=NEW.payment_id;
  PERFORM 1 FROM nova.invoices WHERE id=NEW.invoice_id FOR UPDATE;
  SELECT o.customer_id INTO invoice_customer FROM nova.invoices i JOIN nova.sales_orders o ON o.id=i.order_id WHERE i.id=NEW.invoice_id;
  IF invoice_customer<>paid.customer_id THEN RAISE EXCEPTION 'Allocation customer mismatch'; END IF;
  SELECT outstanding INTO remaining FROM nova.invoice_balances WHERE id=NEW.invoice_id;
  IF remaining<0 THEN RAISE EXCEPTION 'Allocation exceeds invoice balance'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER payment_total AFTER INSERT ON nova.payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nova.check_payment_allocation();
CREATE TRIGGER allocation_balance AFTER INSERT ON nova.payment_allocations FOR EACH ROW EXECUTE FUNCTION nova.check_payment_allocation();
CREATE FUNCTION nova.validate_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_order text;
BEGIN
 IF NEW.category<>'dispatch' OR NEW.status<>'posted' THEN RETURN NEW; END IF;
 SELECT i.order_id INTO source_order FROM nova.dispatches d JOIN nova.invoices i ON i.id=d.invoice_id WHERE d.id=NEW.id AND NOT EXISTS(SELECT 1 FROM nova.credit_notes c WHERE c.invoice_id=i.id);
 IF source_order IS NULL THEN RAISE EXCEPTION 'Dispatch requires active invoice'; END IF;
 IF (SELECT count(*) FROM nova.stock_document_lines WHERE document_id=NEW.id)<>(SELECT count(*) FROM nova.sales_order_lines WHERE order_id=source_order) THEN RAISE EXCEPTION 'Dispatch line count mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM nova.sales_order_lines o JOIN nova.products p ON p.id=o.product_id LEFT JOIN nova.stock_document_lines l ON l.document_id=NEW.id AND l.item_id=p.item_id WHERE o.order_id=source_order AND (l.quantity IS DISTINCT FROM -o.quantity OR l.unit IS DISTINCT FROM 'packet')) THEN RAISE EXCEPTION 'Dispatch quantities do not match approved order'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_dispatch BEFORE UPDATE OF status ON nova.stock_documents FOR EACH ROW EXECUTE FUNCTION nova.validate_dispatch();
