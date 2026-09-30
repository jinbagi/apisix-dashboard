# Resource form / JSON parity

Scope: Route, Service, Stream Route, Upstream, Consumer and SSL creation and
editing. This is a code and browser regression audit of the dashboard's current
resource model, not a claim that the local schemas cover every APISIX version.

## Field coverage matrix

Common identity, description and labels are rendered by `FormPartBasic` where
applicable. Server-generated IDs/timestamps and certificate validity are not
editable payload fields. JSON remains the full-payload editing surface.

| Resource | Visual controls / structured JSON controls | Validation and preservation finding | Resolution |
| --- | --- | --- | --- |
| Route | `uri/uris`, `host/hosts`, `remote_addr/remote_addrs`, methods, WebSocket, priority/status, vars, filter function, script/script ID, service/upstream/plugin-config references, inline upstream, plugins, timeout | Earlier Route work already retains JSON-only fields and opaque plugin/vars values, and shares matching/inline-upstream validation | Retained; existing Route regression suite rerun |
| Service | hosts, WebSocket, script, upstream reference or inline configuration, plugins | Resolver stripped fields outside the local schema; recursive cleanup changed plugin/discovery values; inline backend/rewrite validation absent | Preserve raw validated input and mounted/unmounted fields; clean only known optional controls; share inline validation with Admin API JSON |
| Stream Route | server address/port, remote address, SNI, service/upstream references, inline upstream, plugins, protocol name/superior ID/conf/logger | Same stripping/cleanup and inline-validation gaps; protocol config is opaque JSON | Same preservation and validation fix, including protocol values |
| Upstream | nodes, discovery name/type/args, scheme, balancing/hash/key, pass-host/rewrite host, retries, timeout, TLS, keepalive, active/passive checks | Unknown nested fields were stripped and opaque discovery values cleaned; checks entered in JSON could appear disabled in the visual editor | Retain payload fields and opaque values; infer check switches after JSON replaces the draft; explicit removal still deletes checks |
| Consumer | username, consumer-group reference, plugins, description/labels | JSON-only fields and plugin empty/null/internal-looking keys could be lost | Preserve validated input and opaque plugin values on create and edit |
| SSL | certificate type, SNI/SNIs, default/additional cert-key pairs, protocols/status/labels, client CA/depth/skip-mTLS regex | JSON client config could be removed because `__clientEnabled` was absent; unknown client fields stripped | Infer switch from client config, preserve JSON client settings, explicitly remove client config when disabled; omit validity metadata |

`discovery_args`, Stream protocol `conf`/`logger`, Route vars and plugin JSON are
intentional JSON controls inside the visual form. A dedicated text box for every
provider/plugin-specific property would not constitute complete schema coverage.
Unmodeled top-level or nested properties remain editable through Payload JSON
and now survive a visual round trip in the five newly covered resource editors.

## Problems corrected

1. **Form/JSON round trip — fixed.** The resolver validates known properties but
   returns the original input. React Hook Form retains fields without rendered
   controls. This also preserves deliberate deletion: JSON omission is not
   merged with the old resource to resurrect removed fields.
2. **Save preparation — fixed.** The payload preview, save review and mutation
   use the same preparation function. Optional form strings are cleaned at known
   paths; arbitrary plugin/discovery/protocol objects are never recursively
   cleaned. Empty strings, nulls, false and nested `__` keys retain their meaning.
3. **Inline backend validation — fixed.** Service and Stream Route creation,
   editing and Admin API JSON use the same inline validator as Routes. Missing
   backend nodes/discovery, incomplete discovery pairs and a missing rewrite
   host now report the same nested field path. No inline upstream remains valid
   (for example a plugin-only Service).
4. **Configuration switches — fixed.** Client verification and health checks
   supplied in JSON are reflected in the form. Turning them off explicitly
   deletes the corresponding payload section.

## Browser evidence

The tests use the production build and mocked Admin API responses so unknown
future fields can be checked without depending on a particular server version.
They assert the actual outgoing request body, not just editor text.

![Service inline validation](../en/assets/screenshots/parity-service-validation.png)

![Stream Route inline validation](../en/assets/screenshots/parity-stream-validation.png)

## Verification

- TypeScript, full ESLint and production build.
- Parameterized create/edit round trips and direct Payload JSON saves for all
  five newly covered resource types.
- Service/Stream Route validation equivalence across create, edit and Admin API
  JSON schemas, plus browser error correction and save.
- Explicit SSL client removal, JSON-only field deletion and JSON health-check
  activation/removal.
- Existing Route editor and unsaved-navigation regressions.

The PR records the final local and real-APISIX CI results. Fake certificates and
unknown extension fields in mocked tests do not establish server acceptance.
Server-side validation remains authoritative for those fields.

## Remaining audit queue

- Apply the same preservation review to Consumer Groups, Global Rules, Plugin
  Configs, Credentials, Secrets and Protos. Their create pages still use the
  older resolver/cleanup pipeline; plugin metadata uses a separate drawer flow.
- Compare local field constraints against the connected APISIX version rather
  than assuming these hand-maintained schemas are exhaustive.
- Review SSL certificate/key array pairing and SNI conflict handling: existing
  visual warnings are not a complete server-equivalent validator.
- Exercise upstream node editing with IPv6 and additional node properties;
  the node table has its own object/array conversion separate from this fix.
