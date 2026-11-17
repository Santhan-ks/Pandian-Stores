CREATE FUNCTION nova.guard_published_bom() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.published_at IS NOT NULL THEN RAISE EXCEPTION 'Published BOM cannot be deleted'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.published_at IS NOT NULL AND (to_jsonb(OLD) - 'active') IS DISTINCT FROM (to_jsonb(NEW) - 'active') THEN RAISE EXCEPTION 'Published BOM content is immutable'; END IF;
  IF TG_OP <> 'DELETE' AND NEW.published_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM nova.bom_lines WHERE bom_id = NEW.id) THEN RAISE EXCEPTION 'BOM requires components'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER protect_bom BEFORE UPDATE OR DELETE ON nova.bom_versions FOR EACH ROW EXECUTE FUNCTION nova.guard_published_bom();
--> statement-breakpoint
CREATE FUNCTION nova.guard_bom_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text; material_kind text; component_dimension text; base_dimension text;
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM nova.bom_versions WHERE id = OLD.bom_id AND published_at IS NOT NULL) THEN RAISE EXCEPTION 'Published BOM lines are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT published_at::text INTO target FROM nova.bom_versions WHERE id = NEW.bom_id FOR UPDATE;
  IF target IS NOT NULL THEN RAISE EXCEPTION 'Published BOM lines are immutable'; END IF;
  SELECT i.kind, u.dimension INTO material_kind, base_dimension FROM nova.inventory_items i JOIN nova.units u ON u.code = i.base_unit WHERE i.id = NEW.item_id;
  SELECT dimension INTO component_dimension FROM nova.units WHERE code = NEW.unit;
  IF material_kind = 'finished' OR component_dimension IS DISTINCT FROM base_dimension THEN RAISE EXCEPTION 'Invalid component or incompatible unit'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER protect_bom_line BEFORE INSERT OR UPDATE OR DELETE ON nova.bom_lines FOR EACH ROW EXECUTE FUNCTION nova.guard_bom_line();
--> statement-breakpoint
CREATE FUNCTION nova.guard_master_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'inventory_items' THEN
    IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.base_unit IS DISTINCT FROM OLD.base_unit THEN RAISE EXCEPTION 'Material kind and base unit are immutable'; END IF;
  ELSIF TG_TABLE_NAME = 'products' THEN
    IF NEW.item_id IS DISTINCT FROM OLD.item_id OR NEW.pack_grams IS DISTINCT FROM OLD.pack_grams OR NEW.carton_capacity IS DISTINCT FROM OLD.carton_capacity THEN RAISE EXCEPTION 'Product pack identity is immutable'; END IF;
  ELSE RAISE EXCEPTION 'Reference definitions and audit events are immutable'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_item_identity BEFORE UPDATE ON nova.inventory_items FOR EACH ROW EXECUTE FUNCTION nova.guard_master_identity();
--> statement-breakpoint
CREATE TRIGGER immutable_product_identity BEFORE UPDATE ON nova.products FOR EACH ROW EXECUTE FUNCTION nova.guard_master_identity();
--> statement-breakpoint
CREATE TRIGGER immutable_units BEFORE UPDATE OR DELETE ON nova.units FOR EACH ROW EXECUTE FUNCTION nova.guard_master_identity();
--> statement-breakpoint
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON nova.audit_events FOR EACH ROW EXECUTE FUNCTION nova.guard_master_identity();
--> statement-breakpoint
CREATE FUNCTION nova.validate_product_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nova.inventory_items WHERE id = NEW.item_id AND kind = 'finished' AND base_unit = 'packet') THEN RAISE EXCEPTION 'Product requires a finished packet item'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER validate_product BEFORE INSERT OR UPDATE ON nova.products FOR EACH ROW EXECUTE FUNCTION nova.validate_product_item();
