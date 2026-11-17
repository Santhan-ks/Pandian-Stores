-- Recheck immutable payment totals when allocations are appended, including after payment creation.
CREATE FUNCTION nova.check_allocation_payment_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment_amount numeric; allocated numeric;
BEGIN
 SELECT amount INTO payment_amount FROM nova.payments WHERE id=NEW.payment_id FOR UPDATE;
 SELECT coalesce(sum(amount),0) INTO allocated FROM nova.payment_allocations WHERE payment_id=NEW.payment_id;
 IF allocated<>payment_amount THEN RAISE EXCEPTION 'Allocations must equal the immutable payment amount'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER allocation_payment_total AFTER INSERT ON nova.payment_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nova.check_allocation_payment_total();
