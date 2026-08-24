# Hosted single-operator canonical backend

The notebook must be reachable off the home LAN, so the canonical backend moves to hosted infrastructure. Production does not include a 24/7 LAN appliance (Pi or Mac LAN daemon). The Nano reaches that backend through an authenticated outbound device connection, not through a home copy of the notebook. v1 is one operator, not a multi-tenant product.

Portability means a weekend restore onto another vendor from portable primitives: a container or VM, a SQL database, and an S3-compatible object store. It does not mean live multi-cloud or a Pulumi program that pretends AWS, Fly, and DigitalOcean are the same resources.

This supersedes the product-requirements line that listed “cloud dependence” as a non-goal. Desktop and LAN-appliance placements must not own a second notebook. The LAN appliance is not a production topology to keep.

**Considered options**: expose the existing LAN service through a tunnel; keep a home device agent that owns USB and writes into the host; keep home canonical and host a replica; build accounts and tenancy in v1.
