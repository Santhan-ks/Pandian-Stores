-- Executed as pandian_owner after every migration. New writable tables require review.
REVOKE ALL ON SCHEMA nova FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA nova FROM PUBLIC, pandian_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nova FROM PUBLIC, pandian_app;
GRANT USAGE ON SCHEMA nova TO pandian_app;
GRANT SELECT ON ALL TABLES IN SCHEMA nova TO pandian_app;
GRANT INSERT, UPDATE, DELETE ON
  nova.users, nova.accounts, nova.sessions, nova.verifications, nova.user_roles,
  nova.territories, nova.customers, nova.suppliers, nova.inventory_items,
  nova.products, nova.product_prices, nova.bom_versions, nova.bom_lines,
  nova.stock_documents, nova.stock_document_lines, nova.production_runs, nova.production_inputs,
  nova.sales_orders, nova.sales_order_lines, nova.invoice_sequences,
  nova.business_profiles, nova.product_tax_settings, nova.login_attempts
TO pandian_app;
-- PostgreSQL row locks require UPDATE on at least one column. These grants
-- preserve dispatch/allocation locks; existing immutable triggers reject edits.
GRANT UPDATE(id) ON nova.invoices, nova.payments TO pandian_app;
GRANT INSERT ON nova.audit_events, nova.deleted_records, nova.inventory_movements,
  nova.production_cost_snapshots, nova.production_overheads, nova.invoices,
  nova.dispatches, nova.payments, nova.payment_allocations, nova.credit_notes
TO pandian_app;
-- Ledger/snapshot inserts remain guarded by trigger depth and document state.
-- No TRUNCATE, REFERENCES, TRIGGER, CREATE, schema ownership or role membership.
ALTER DEFAULT PRIVILEGES IN SCHEMA nova REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
