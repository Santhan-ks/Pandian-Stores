ALTER TABLE nova.invoices ADD COLUMN issuance_mode text NOT NULL DEFAULT 'demo' CHECK(issuance_mode IN ('demo','real'));
CREATE TABLE nova.business_profiles (
 mode text PRIMARY KEY CHECK(mode IN ('demo','real')), name text NOT NULL CHECK(length(trim(name))>=2),
 address text NOT NULL CHECK(length(trim(address))>=5), state text NOT NULL, state_code text NOT NULL CHECK(state_code ~ '^[0-9]{2}$'),
 gstin text NOT NULL, updated_by text NOT NULL REFERENCES nova.users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE nova.product_tax_settings (
 mode text NOT NULL REFERENCES nova.business_profiles(mode), product_id text NOT NULL REFERENCES nova.products(id),
 hsn text NOT NULL CHECK(hsn ~ '^[0-9]{4,8}$'), PRIMARY KEY(mode,product_id)
);
