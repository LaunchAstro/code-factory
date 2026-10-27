# Product identity

The `name` in [product.json](../product.json) is the current public product name.
Use it for product titles, navigation and other branded output when the first
application components are built. There is no application UI in this foundation.

To rename the product, edit that value and the first lines of README.md
(`# ` and the name) and NOTICE (the name alone) by hand. Run
`corepack pnpm brand:check`, or `corepack pnpm check`: it fails while either
heading differs from the metadata, and prints, per file, the current first line
and the line it should be, and nothing else from the file. It never writes
either file; `--write` is refused.
Use neutral project wording in other documentation so a display-name change
stays small.

The package identity in `package.json`, which ships as the placeholder
`@your-scope/your-product`, along with tooling variables, module paths
and future persisted identifiers, are technical contracts. Keep them independent
of the display name. A branding change must not require a data migration or a
rewrite of permission, API or storage identifiers.

Repository ownership, copyright holders, contact addresses and deployment URLs
are separate records. A new name changes none of them automatically. Configure
website and API origins explicitly when deployment is authorised; never derive
a domain or assume its extension from the product name.
