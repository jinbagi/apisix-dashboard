# Console collections and request variables

Session presets now have a collection and can be searched, renamed, moved and deleted in the Presets drawer. Legacy presets appear under Unfiled. Names are unique within a collection, ignoring case. Presets remain in session storage for the current browser tab. The 20-request limit blocks new entries instead of silently evicting the oldest request. Failed storage writes preserve the existing list and show an error.

Use `{{name}}` placeholders in the resource path suffix, query values and JSON string values. Open Variables, enter non-secret values and select Preview resolved request. Path/query substitutions are URL encoded; JSON substitutions preserve quoting and remain strings. Numbers, booleans, arrays and literal JSON property names retain their types and order. Missing or malformed placeholders, duplicate variable names, invalid JSON and dot path segments block resolution.

Variable values stay in component memory, with no new browser persistence. Keep template closes the preview without replacing the draft. Use resolved request updates only the Console draft; Send remains a separate explicit action. Editing any variable invalidates the previous preview. Ctrl/Cmd+Enter cannot send a request while the variable, preset or save-preset dialogs are open.

The short narrow-screen modal keeps its actions visible while its content scrolls. Syntax help is collapsible so the resolved request has useful editing space. Existing draft replacement and navigation guards still protect unsent work.

## Verification

Production-preview fixtures cover URL and JSON escaping, literal own keys, invalid/missing variables, no implicit requests, memory-only values, collection filtering and rename collisions, legacy presets, storage errors, the capacity limit and narrow layouts. Existing Console draft tests cover navigation, replacement and in-flight requests. The service-backed Console suite remains part of repository CI.

![Resolved request](./assets/screenshots/console-variables-desktop.png)
![Narrow request preview](./assets/screenshots/console-variables-narrow.png)
![Preset collections](./assets/screenshots/console-collections-narrow.png)
