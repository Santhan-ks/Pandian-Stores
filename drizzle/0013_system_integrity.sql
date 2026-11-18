CREATE TABLE nova.login_attempts (key text PRIMARY KEY, attempts integer NOT NULL CHECK(attempts>0), expires_at timestamptz NOT NULL);
CREATE INDEX login_attempt_expiry ON nova.login_attempts(expires_at);
CREATE INDEX payment_allocation_invoice ON nova.payment_allocations(invoice_id);
CREATE OR REPLACE FUNCTION nova.guard_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='sales_order_lines' THEN
  IF TG_OP='UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN RAISE EXCEPTION 'Order line ownership is immutable'; END IF;
  PERFORM 1 FROM nova.sales_orders WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END AND status='submitted' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order lines are frozen after approval'; END IF;
 ELSE
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Orders cannot be deleted'; END IF;
  IF (to_jsonb(NEW)-'status'-'reason') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'reason') THEN RAISE EXCEPTION 'Order identity and submitted details are immutable'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
   (OLD.status='submitted' AND NEW.status IN ('approved','rejected')) OR
   (OLD.status='approved' AND NEW.status='invoiced') OR
   (OLD.status='invoiced' AND NEW.status IN ('dispatched','cancelled')) OR
   (OLD.status='dispatched' AND NEW.status='cancelled')
  ) THEN RAISE EXCEPTION 'Invalid order lifecycle transition'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE FUNCTION nova.validate_full_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invoice_amount numeric;
BEGIN
 SELECT total INTO invoice_amount FROM nova.invoices WHERE id=NEW.invoice_id FOR UPDATE;
 IF NEW.amount IS DISTINCT FROM invoice_amount THEN RAISE EXCEPTION 'Full credit must equal the original invoice total'; END IF;
 IF EXISTS(SELECT 1 FROM nova.payment_allocations WHERE invoice_id=NEW.invoice_id) THEN RAISE EXCEPTION 'Paid invoices require a refund workflow'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER credit_insert_guard BEFORE INSERT ON nova.credit_notes FOR EACH ROW EXECUTE FUNCTION nova.validate_full_credit();
