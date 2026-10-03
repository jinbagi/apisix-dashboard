# JSON Editor Standard

The dashboard has four named JSON editing contexts:

- Payload JSON: edit the create payload that the Visual Editor will submit.
- Admin API JSON: PATCH an existing resource and verify the saved state.
- Plugin JSON: edit one plugin config inside the plugin Fields drawer.
- Request JSON and Response JSON: build direct Admin API requests and inspect
  responses in the API Console.

These contexts have different actions, but they share one editing standard.

## Shared Surface

- Use `JsonCodeEditor` for editable and read-only JSON.
- Use two-space indentation, line numbers, no minimap, strict JSON diagnostics,
  and the current dashboard light or dark theme.
- Use `JsonSchemaGuide` when a dashboard schema is available.
- Render field names as inline code and distinguish resource identity,
  unconditional requirements, and conditional requirements.
- Keep shared resource validation rules in `resourceValidation.ts`, used by both
  form schemas and `resourceJsonSchema.ts`. Keep JSON guidance in
  `resourceJsonSchema.ts`.

## Contextual Actions

- Payload JSON submits the complete create payload through the form workflow.
- Same-draft editors such as Payload JSON and Plugin JSON provide an explicit
  apply action for reviewing valid JSON edits in the paired visual editor.
- Admin API JSON editors show identity fields separately as values managed by the
  Admin API path. The editable JSON excludes read-only fields, sends changed
  editable fields with PATCH, and verifies the saved resource with a follow-up
  read.
- Plugin JSON edits only the selected plugin config object, not the full APISIX
  resource payload.
- Request JSON sends the selected method and payload exactly as configured.
- Read-only response editors use the same JSON presentation without editing
  controls.

Do not add a new standalone Monaco JSON configuration when one of these shared
surfaces can be used.

## Form and JSON parity

- Route forms use native `vars` arrays. The condition builder handles simple
  string comparisons; complex expressions stay editable as JSON without coercion.
- Preserve fields that the visual Route form does not represent and existing
  combined traffic targets. Only explicit target changes clear prior selections.
- Show common matching fields (hosts, remote addresses, WebSocket) directly.
- Validate URI/host/address conflicts consistently in both editors. Do not
  silently choose a field or discard an invalid expression during serialization.
- Route form updates verify changed and removed fields after the Admin API write,
  using the same mismatch rules as Admin API JSON.
