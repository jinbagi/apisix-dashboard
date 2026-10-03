/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export type PluginCatalogEntry = {
  description: string;
  category: string;
  keywords: string[];
  capabilities: string[];
};

const entries: Record<string, PluginCatalogEntry> = {
  'ai-proxy': {
    description:
      'Proxy requests to OpenAI, Bedrock, Vertex AI, Anthropic, and other LLM providers.',
    category: 'AI Gateway',
    keywords: ['llm', 'model', 'bedrock', 'openai', 'anthropic', 'gemini'],
    capabilities: ['LLM proxy', 'Streaming', 'Provider conversion'],
  },
  'ai-proxy-multi': {
    description:
      'Balance AI requests across uniquely named providers with health checks and bounded fallback for selected HTTP statuses.',
    category: 'AI Gateway',
    keywords: ['llm', 'fallback', 'load balancing', 'retry', 'multi provider', 'fallback_http_statuses'],
    capabilities: ['Multi-provider', 'Fallback', 'Health checks'],
  },
  'ai-prompt-guard': {
    description:
      'Validate AI prompts against allow and deny patterns, with configurable handling for unsupported request formats.',
    category: 'AI Gateway',
    keywords: ['llm', 'prompt', 'guardrail', 'consumer', 'fail mode'],
    capabilities: ['Prompt guardrails', 'Consumer policies', 'Fail mode'],
  },
  'ai-aliyun-content-moderation': {
    description:
      'Moderate AI requests and responses with Alibaba Cloud services and explicit unsupported-request handling.',
    category: 'AI Gateway',
    keywords: ['llm', 'moderation', 'aliyun', 'consumer', 'fail mode'],
    capabilities: ['Content moderation', 'Request checks', 'Fail mode'],
  },
  'ai-aws-content-moderation': {
    description:
      'Moderate AI request content with AWS Comprehend and configurable handling for non-AI traffic.',
    category: 'AI Gateway',
    keywords: ['llm', 'moderation', 'aws', 'comprehend', 'fail mode'],
    capabilities: ['Content moderation', 'AWS Comprehend', 'Fail mode'],
  },
  'openid-connect': {
    description:
      'Authenticate requests with OpenID Connect, including local JWT verification, PKCE, and lua-resty-session 4.x settings.',
    category: 'Authentication',
    keywords: ['oidc', 'oauth', 'jwt', 'pkce', 'session', 'sso'],
    capabilities: ['OIDC', 'Local JWT verification', 'Session management'],
  },
  'forward-auth': {
    description:
      'Delegate authorization to an external service with bounded POST request-body forwarding.',
    category: 'Authentication',
    keywords: ['external auth', 'authorization', 'request body limit'],
    capabilities: ['External authorization', 'Body size limit'],
  },
  'hmac-auth': {
    description:
      'Authenticate signed requests with HMAC credentials and bounded request-body digest validation.',
    category: 'Authentication',
    keywords: ['signature', 'digest', 'request body limit', 'consumer'],
    capabilities: ['HMAC signatures', 'Body validation', 'Body size limit'],
  },
  'batch-requests': {
    description:
      'Execute internal request pipelines with metadata limits for request bodies, item counts, and individual or aggregate response bodies.',
    category: 'Traffic',
    keywords: ['batch', 'pipeline', 'metadata', 'request limit', 'response size'],
    capabilities: ['Request pipeline', 'Pipeline limits', 'Response limits'],
  },
  'limit-count': {
    description:
      'Limit request counts with fixed or sliding windows using local, Redis, Redis Cluster, or Redis Sentinel counters.',
    category: 'Traffic',
    keywords: [
      'rate limit',
      'sliding window',
      'redis sentinel',
      'delayed sync',
      'quota',
    ],
    capabilities: [
      'Request quotas',
      'Sliding windows',
      'Redis Sentinel',
      'Delayed synchronization',
    ],
  },
  'proxy-buffering': {
    description:
      'Control buffering of upstream responses before they are sent to clients.',
    category: 'Traffic',
    keywords: ['buffer', 'upstream response', 'streaming'],
    capabilities: ['Response buffering'],
  },
  'graphql-proxy-cache': {
    description:
      'Cache GraphQL query responses to reduce upstream load and response latency.',
    category: 'Traffic',
    keywords: ['graphql', 'cache', 'query'],
    capabilities: ['GraphQL', 'Response cache'],
  },
  'graphql-limit-count': {
    description:
      'Charge GraphQL quotas by depth, complexity, or node quantity, with Service cost decorations and a maximum query cost.',
    category: 'Security',
    keywords: ['graphql', 'limit', 'complexity', 'node_quantifier', 'cost', 'decorations', 'dos'],
    capabilities: ['GraphQL', 'Query cost', 'Request limits'],
  },
  'saml-auth': {
    description:
      'Authenticate SAML 2.0 logins with issuer, audience, ACS URL, clock skew, and optional assertion replay checks.',
    category: 'Authentication',
    keywords: ['saml', 'sso', 'identity provider', 'login', 'replay', 'audience', 'acs'],
    capabilities: ['SAML 2.0', 'SSO', 'Response validation'],
  },
  'feishu-auth': {
    description:
      'Authenticate users with Feishu OAuth and optionally pass user information upstream.',
    category: 'Authentication',
    keywords: ['feishu', 'oauth', 'login', 'enterprise'],
    capabilities: ['Enterprise login', 'OAuth'],
  },
  'dingtalk-auth': {
    description:
      'Authenticate users with DingTalk OAuth and optionally pass user information upstream.',
    category: 'Authentication',
    keywords: ['dingtalk', 'oauth', 'login', 'enterprise'],
    capabilities: ['Enterprise login', 'OAuth'],
  },
  acl: {
    description:
      'Allow or deny requests by matching values such as Consumer labels against access rules.',
    category: 'Security',
    keywords: ['access control', 'allowlist', 'denylist', 'consumer label'],
    capabilities: ['Access control', 'Consumer labels'],
  },
  'data-mask': {
    description:
      'Mask sensitive values in query parameters, headers, and JSON request bodies.',
    category: 'Security',
    keywords: ['pii', 'redact', 'sensitive data', 'privacy', 'mask'],
    capabilities: ['Data masking', 'PII protection'],
  },
  'proxy-cache': {
    description:
      'Cache upstream responses in APISIX to reduce backend load and response latency.',
    category: 'Traffic',
    keywords: ['cache', 'upstream response', 'performance'],
    capabilities: ['Response cache'],
  },
  'body-transformer': {
    description:
      'Transform request and response bodies between formats using templates.',
    category: 'Transformation',
    keywords: ['body', 'transform', 'template', 'json', 'xml'],
    capabilities: ['Body transform'],
  },
  'exit-transformer': {
    description:
      'Transform APISIX error status codes, headers, and response bodies before returning them.',
    category: 'Transformation',
    keywords: ['error response', 'status code', 'body transform', 'header'],
    capabilities: ['Error transform', 'Response transform'],
  },
  'traffic-label': {
    description:
      'Attach labels or headers to requests when configured traffic conditions match.',
    category: 'Traffic',
    keywords: ['label', 'condition', 'routing', 'request header'],
    capabilities: ['Traffic classification', 'Conditional labels'],
  },
  'oas-validator': {
    description:
      'Validate requests and responses against an OpenAPI specification.',
    category: 'Security',
    keywords: ['openapi', 'oas', 'schema', 'request validation', 'response validation'],
    capabilities: ['OpenAPI validation', 'Schema enforcement'],
  },
  'error-page': {
    description:
      'Return customized error pages or JSON responses for selected HTTP status codes.',
    category: 'Transformation',
    keywords: ['error page', 'custom response', 'status code', 'html', 'json'],
    capabilities: ['Custom errors', 'Error pages'],
  },
  'real-ip': {
    description:
      'Rewrite the client IP address and port that APISIX uses for routing, logging, and upstream forwarding.',
    category: 'Others',
    keywords: ['client ip', 'x-forwarded-for', 'remote address'],
    capabilities: ['Client IP rewrite'],
  },
  ai: {
    description:
      'Provides APISIX AI Gateway support for managing LLM and AI traffic through the plugin system.',
    category: 'AI Gateway',
    keywords: ['ai gateway', 'llm', 'model'],
    capabilities: ['AI gateway'],
  },
  'client-control': {
    description:
      'Control NGINX client request handling, including the maximum allowed request body size.',
    category: 'Traffic',
    keywords: ['client body', 'nginx', 'request size'],
    capabilities: ['Request body limit'],
  },
  'proxy-control': {
    description:
      'Dynamically control NGINX proxy behavior such as request buffering.',
    category: 'Traffic',
    keywords: ['nginx proxy', 'buffering', 'request buffering'],
    capabilities: ['Proxy controls'],
  },
  'request-id': {
    description:
      'Add a unique request ID to proxied requests for tracing, correlation, and downstream logs.',
    category: 'Traffic',
    keywords: ['request id', 'correlation', 'trace id'],
    capabilities: ['Request correlation'],
  },
  zipkin: {
    description:
      'Report distributed tracing spans to Zipkin-compatible tracing systems.',
    category: 'Observability',
    keywords: ['tracing', 'zipkin', 'opentracing'],
    capabilities: ['Distributed tracing'],
  },
  'ext-plugin-pre-req': {
    description:
      'Run external plugin runner logic before APISIX executes built-in Lua plugins.',
    category: 'Others',
    keywords: ['external plugin', 'plugin runner', 'pre request'],
    capabilities: ['External runner'],
  },
  'ext-plugin-post-req': {
    description:
      'Run external plugin runner logic after built-in Lua plugins and before proxying upstream.',
    category: 'Others',
    keywords: ['external plugin', 'plugin runner', 'post request'],
    capabilities: ['External runner'],
  },
  'ext-plugin-post-resp': {
    description:
      'Run external plugin runner logic during the response phase after upstream handling.',
    category: 'Others',
    keywords: ['external plugin', 'plugin runner', 'response phase'],
    capabilities: ['External runner'],
  },
  'fault-injection': {
    description:
      'Simulate faults or latency to test service resilience without changing upstream services.',
    category: 'Transformation',
    keywords: ['chaos', 'latency', 'abort', 'resilience'],
    capabilities: ['Fault simulation', 'Latency injection'],
  },
  mocking: {
    description:
      'Return mock API responses directly from APISIX without forwarding requests upstream.',
    category: 'Transformation',
    keywords: ['mock', 'testing', 'response'],
    capabilities: ['Mock responses'],
  },
  'serverless-pre-function': {
    description:
      'Run custom Lua logic at the beginning of a configured APISIX execution phase.',
    category: 'Serverless',
    keywords: ['lua', 'function', 'serverless', 'phase'],
    capabilities: ['Custom Lua hook'],
  },
  'serverless-post-function': {
    description:
      'Run custom Lua logic at the end of a configured APISIX execution phase.',
    category: 'Serverless',
    keywords: ['lua', 'function', 'serverless', 'phase'],
    capabilities: ['Custom Lua hook'],
  },
  cors: {
    description:
      'Enable and configure Cross-Origin Resource Sharing headers for browser clients.',
    category: 'Security',
    keywords: ['cors', 'browser', 'cross origin'],
    capabilities: ['CORS headers'],
  },
  'ip-restriction': {
    description:
      'Restrict access to routes or services with IP address allowlists or denylists.',
    category: 'Security',
    keywords: ['ip', 'allowlist', 'denylist', 'access control'],
    capabilities: ['IP access control'],
  },
  'ua-restriction': {
    description:
      'Restrict route or service access by matching the User-Agent request header.',
    category: 'Security',
    keywords: ['user agent', 'allowlist', 'denylist'],
    capabilities: ['User-Agent rules'],
  },
  'referer-restriction': {
    description:
      'Restrict access by allowlisting or denylisting Referer request header values.',
    category: 'Security',
    keywords: ['referer', 'allowlist', 'denylist'],
    capabilities: ['Referer rules'],
  },
  csrf: {
    description:
      'Protect APIs from CSRF attacks using a double-submit cookie validation pattern.',
    category: 'Security',
    keywords: ['csrf', 'cookie', 'security'],
    capabilities: ['CSRF protection'],
  },
  'uri-blocker': {
    description:
      'Block requests whose URI matches configured block rules.',
    category: 'Security',
    keywords: ['uri', 'block', 'deny'],
    capabilities: ['URI blocking'],
  },
  'request-validation': {
    description:
      'Validate requests against configured JSON schema rules before forwarding upstream.',
    category: 'Security',
    keywords: ['validation', 'json schema', 'request'],
    capabilities: ['Request validation'],
  },
  'chaitin-waf': {
    description:
      'Integrate Chaitin SafeLine WAF inspection into APISIX request processing.',
    category: 'Security',
    keywords: ['waf', 'safeline', 'chaitin'],
    capabilities: ['WAF inspection'],
  },
  'multi-auth': {
    description:
      'Allow a route or service to accept multiple authentication methods.',
    category: 'Authentication',
    keywords: ['authentication', 'multiple auth', 'consumer'],
    capabilities: ['Multiple auth methods'],
  },
  'cas-auth': {
    description:
      'Authenticate users with a CAS identity provider from the service provider perspective.',
    category: 'Authentication',
    keywords: ['cas', 'sso', 'identity provider'],
    capabilities: ['CAS SSO'],
  },
  'authz-casbin': {
    description:
      'Authorize requests with Lua Casbin policies and supported access control models.',
    category: 'Authentication',
    keywords: ['authorization', 'casbin', 'rbac', 'abac'],
    capabilities: ['Policy authorization'],
  },
  'authz-casdoor': {
    description:
      'Add centralized authentication and authorization through Casdoor.',
    category: 'Authentication',
    keywords: ['casdoor', 'authorization', 'sso'],
    capabilities: ['Casdoor auth'],
  },
  'wolf-rbac': {
    description:
      'Provide role-based access control for routes or services through Wolf RBAC.',
    category: 'Authentication',
    keywords: ['rbac', 'wolf', 'authorization'],
    capabilities: ['Role-based access'],
  },
  'ldap-auth': {
    description:
      'Authenticate route or service requests with LDAP credentials.',
    category: 'Authentication',
    keywords: ['ldap', 'authentication', 'directory'],
    capabilities: ['LDAP auth'],
  },
  'basic-auth': {
    description:
      'Authenticate requests with HTTP Basic Authentication credentials from Consumers.',
    category: 'Authentication',
    keywords: ['basic auth', 'consumer', 'username', 'password'],
    capabilities: ['Basic auth'],
  },
  'jwt-auth': {
    description:
      'Authenticate requests by validating JWT credentials associated with Consumers.',
    category: 'Authentication',
    keywords: ['jwt', 'token', 'consumer'],
    capabilities: ['JWT auth'],
  },
  'jwe-decrypt': {
    description:
      'Decrypt JSON Web Encryption tokens from incoming requests before upstream handling.',
    category: 'Authentication',
    keywords: ['jwe', 'decrypt', 'token'],
    capabilities: ['JWE decryption'],
  },
  'key-auth': {
    description:
      'Authenticate requests with API keys configured on APISIX Consumers.',
    category: 'Authentication',
    keywords: ['api key', 'consumer', 'authentication'],
    capabilities: ['API key auth'],
  },
  'consumer-restriction': {
    description:
      'Restrict access by Consumer, Consumer Group, credential, or service-related attributes.',
    category: 'Security',
    keywords: ['consumer', 'restriction', 'access control'],
    capabilities: ['Consumer access control'],
  },
  'attach-consumer-label': {
    description:
      'Attach selected authenticated Consumer labels to upstream request headers.',
    category: 'Traffic',
    keywords: ['consumer label', 'header', 'upstream'],
    capabilities: ['Consumer label headers'],
  },
  opa: {
    description:
      'Authorize requests by integrating APISIX with Open Policy Agent.',
    category: 'Authentication',
    keywords: ['opa', 'policy', 'authorization'],
    capabilities: ['OPA authorization'],
  },
  'authz-keycloak': {
    description:
      'Authorize requests with Keycloak Identity Server policies.',
    category: 'Authentication',
    keywords: ['keycloak', 'authorization', 'identity server'],
    capabilities: ['Keycloak authz'],
  },
  'ai-request-rewrite': {
    description:
      'Use an LLM prompt to rewrite client request content before proxying upstream.',
    category: 'AI Gateway',
    keywords: ['llm', 'rewrite', 'prompt', 'request'],
    capabilities: ['AI request rewrite'],
  },
  'ai-prompt-template': {
    description:
      'Apply reusable prompt templates that accept values through declared variables.',
    category: 'AI Gateway',
    keywords: ['prompt template', 'llm', 'variables'],
    capabilities: ['Prompt templates'],
  },
  'ai-prompt-decorator': {
    description:
      'Prepend or append configured messages to user prompts before sending them to an LLM.',
    category: 'AI Gateway',
    keywords: ['prompt', 'prepend', 'append', 'llm'],
    capabilities: ['Prompt decoration'],
  },
  'ai-rag': {
    description:
      'Add retrieval-augmented generation by fetching context from external data sources.',
    category: 'AI Gateway',
    keywords: ['rag', 'retrieval', 'llm', 'context'],
    capabilities: ['RAG context'],
  },
  'ai-rate-limiting': {
    description:
      'Limit LLM usage by tracking and throttling token consumption over time.',
    category: 'AI Gateway',
    keywords: ['llm', 'token', 'rate limit', 'quota'],
    capabilities: ['Token rate limits'],
  },
  'proxy-mirror': {
    description:
      'Mirror client requests to another endpoint while the original request continues normally.',
    category: 'Traffic',
    keywords: ['mirror', 'shadow traffic', 'testing'],
    capabilities: ['Traffic mirroring'],
  },
  'proxy-rewrite': {
    description:
      'Rewrite upstream request details such as URI, method, host, scheme, and headers.',
    category: 'Transformation',
    keywords: ['rewrite', 'upstream', 'headers', 'uri'],
    capabilities: ['Request rewrite'],
  },
  workflow: {
    description:
      'Use expression-based rules to build complex traffic control workflows.',
    category: 'Traffic',
    keywords: ['workflow', 'expression', 'traffic control'],
    capabilities: ['Conditional workflow'],
  },
  'api-breaker': {
    description:
      'Protect upstream services with circuit breaker behavior based on unhealthy responses.',
    category: 'Security',
    keywords: ['circuit breaker', 'resilience', 'upstream'],
    capabilities: ['Circuit breaker'],
  },
  'limit-conn': {
    description:
      'Limit the number of concurrent requests allowed for matching traffic.',
    category: 'Traffic',
    keywords: ['rate limit', 'concurrency', 'quota'],
    capabilities: ['Concurrency limits'],
  },
  'limit-req': {
    description:
      'Limit request rate using leaky-bucket style throttling.',
    category: 'Traffic',
    keywords: ['rate limit', 'leaky bucket', 'throttle'],
    capabilities: ['Request throttling'],
  },
  gzip: {
    description:
      'Dynamically configure gzip compression behavior for responses.',
    category: 'Traffic',
    keywords: ['gzip', 'compression', 'response'],
    capabilities: ['Response compression'],
  },
  'traffic-split': {
    description:
      'Split traffic across upstreams by weight for canary releases and gradual rollout.',
    category: 'Traffic',
    keywords: ['canary', 'traffic split', 'weighted upstream'],
    capabilities: ['Weighted routing'],
  },
  redirect: {
    description:
      'Return configured HTTP redirects for matching requests.',
    category: 'Others',
    keywords: ['redirect', 'location', 'http status'],
    capabilities: ['HTTP redirects'],
  },
  'response-rewrite': {
    description:
      'Rewrite upstream response status, headers, and body before returning to the client.',
    category: 'Transformation',
    keywords: ['response', 'rewrite', 'headers', 'body'],
    capabilities: ['Response rewrite'],
  },
  'mcp-bridge': {
    description:
      'Expose stdio-based MCP servers as HTTP SSE services through APISIX.',
    category: 'AI Gateway',
    keywords: ['mcp', 'sse', 'ai agent', 'stdio'],
    capabilities: ['MCP bridge'],
  },
  'openapi-to-mcp': {
    description:
      'Expose OpenAPI operations as MCP tools using stateless Streamable HTTP or session-based SSE.',
    category: 'Transformation',
    keywords: ['openapi', 'swagger', 'mcp', 'ai agent', 'tools', 'streamable http', 'sse'],
    capabilities: ['OpenAPI tools', 'MCP server', 'Streamable HTTP'],
  },
  'websocket-proxy': {
    description:
      'Configure client and upstream WebSocket frame size limits for ws and wss upstreams.',
    category: 'Traffic',
    keywords: ['websocket', 'ws', 'wss', 'frame', 'payload', 'message size'],
    capabilities: ['WebSocket frames', 'Payload limits'],
  },
  degraphql: {
    description:
      'Map REST-style HTTP requests to upstream GraphQL queries.',
    category: 'Transformation',
    keywords: ['graphql', 'rest', 'query mapping'],
    capabilities: ['REST to GraphQL'],
  },
  'kafka-proxy': {
    description:
      'Configure advanced Kafka upstream proxy behavior, including SASL authentication.',
    category: 'Others',
    keywords: ['kafka', 'proxy', 'sasl'],
    capabilities: ['Kafka proxy'],
  },
  'grpc-transcode': {
    description:
      'Transcode between HTTP requests and gRPC requests and responses.',
    category: 'Transformation',
    keywords: ['grpc', 'http', 'protobuf', 'transcode'],
    capabilities: ['HTTP gRPC transcoding'],
  },
  'grpc-web': {
    description:
      'Translate browser-compatible gRPC-Web requests into native upstream gRPC calls.',
    category: 'Transformation',
    keywords: ['grpc-web', 'browser', 'grpc'],
    capabilities: ['gRPC-Web proxy'],
  },
  'http-dubbo': {
    description:
      'Proxy HTTP requests to Apache Dubbo services.',
    category: 'Others',
    keywords: ['dubbo', 'http', 'rpc'],
    capabilities: ['HTTP to Dubbo'],
  },
  'public-api': {
    description:
      'Expose selected APISIX plugin APIs through the public HTTP API router.',
    category: 'Security',
    keywords: ['public api', 'endpoint', 'plugin api'],
    capabilities: ['Public plugin API'],
  },
  prometheus: {
    description:
      'Expose APISIX metrics in Prometheus exposition format.',
    category: 'Observability',
    keywords: ['prometheus', 'metrics', 'monitoring'],
    capabilities: ['Metrics export'],
  },
  datadog: {
    description:
      'Send APISIX metrics to a locally running Datadog agent.',
    category: 'Observability',
    keywords: ['datadog', 'metrics', 'monitoring'],
    capabilities: ['Datadog metrics'],
  },
  lago: {
    description:
      'Report usage and billing events from APISIX to Lago.',
    category: 'Observability',
    keywords: ['lago', 'billing', 'usage'],
    capabilities: ['Usage billing'],
  },
  'loki-logger': {
    description:
      'Push APISIX access logs to Grafana Loki.',
    category: 'Observability',
    keywords: ['loki', 'logs', 'grafana'],
    capabilities: ['Loki logging'],
  },
  'elasticsearch-logger': {
    description:
      'Forward APISIX access logs to Elasticsearch for storage and analysis.',
    category: 'Observability',
    keywords: ['elasticsearch', 'logs', 'analytics'],
    capabilities: ['Elasticsearch logging'],
  },
  echo: {
    description:
      'Return configured echo responses to help develop and test APISIX plugins.',
    category: 'Others',
    keywords: ['echo', 'testing', 'plugin development'],
    capabilities: ['Echo response'],
  },
  loggly: {
    description:
      'Forward APISIX logs to SolarWinds Loggly for analysis and storage.',
    category: 'Observability',
    keywords: ['loggly', 'logs', 'solarwinds'],
    capabilities: ['Loggly logging'],
  },
  'http-logger': {
    description:
      'Push APISIX access logs to HTTP or HTTPS servers.',
    category: 'Observability',
    keywords: ['http', 'logs', 'access log'],
    capabilities: ['HTTP logging'],
  },
  'splunk-hec-logging': {
    description:
      'Forward logs to Splunk HTTP Event Collector.',
    category: 'Observability',
    keywords: ['splunk', 'hec', 'logs'],
    capabilities: ['Splunk logging'],
  },
  'skywalking-logger': {
    description:
      'Push APISIX access logs to Apache SkyWalking OAP over HTTP.',
    category: 'Observability',
    keywords: ['skywalking', 'logs', 'oap'],
    capabilities: ['SkyWalking logging'],
  },
  'google-cloud-logging': {
    description:
      'Send APISIX access logs to Google Cloud Logging.',
    category: 'Observability',
    keywords: ['google cloud', 'logging', 'logs'],
    capabilities: ['Cloud Logging'],
  },
  'sls-logger': {
    description:
      'Push APISIX logs to Alibaba Cloud Log Service.',
    category: 'Observability',
    keywords: ['aliyun', 'sls', 'logs'],
    capabilities: ['SLS logging'],
  },
  'tcp-logger': {
    description:
      'Stream APISIX access logs to TCP servers.',
    category: 'Observability',
    keywords: ['tcp', 'logs', 'access log'],
    capabilities: ['TCP logging'],
  },
  'kafka-logger': {
    description:
      'Publish APISIX access logs to Kafka topics.',
    category: 'Observability',
    keywords: ['kafka', 'logs', 'topic'],
    capabilities: ['Kafka logging'],
  },
  'rocketmq-logger': {
    description:
      'Publish APISIX access logs as JSON objects to RocketMQ clusters.',
    category: 'Observability',
    keywords: ['rocketmq', 'logs', 'json'],
    capabilities: ['RocketMQ logging'],
  },
  syslog: {
    description:
      'Push APISIX log data to Syslog.',
    category: 'Observability',
    keywords: ['syslog', 'logs'],
    capabilities: ['Syslog logging'],
  },
  'udp-logger': {
    description:
      'Stream APISIX access logs to UDP servers.',
    category: 'Observability',
    keywords: ['udp', 'logs', 'access log'],
    capabilities: ['UDP logging'],
  },
  'file-logger': {
    description:
      'Write APISIX log streams to a configured file path.',
    category: 'Observability',
    keywords: ['file', 'logs', 'access log'],
    capabilities: ['File logging'],
  },
  'clickhouse-logger': {
    description:
      'Push APISIX logs to ClickHouse for storage and analysis.',
    category: 'Observability',
    keywords: ['clickhouse', 'logs', 'analytics'],
    capabilities: ['ClickHouse logging'],
  },
  'tencent-cloud-cls': {
    description:
      'Forward APISIX logs to Tencent Cloud CLS topics.',
    category: 'Observability',
    keywords: ['tencent', 'cls', 'logs'],
    capabilities: ['Tencent CLS logging'],
  },
  inspect: {
    description:
      'Expose APISIX runtime inspection information for debugging.',
    category: 'Observability',
    keywords: ['inspect', 'runtime', 'debug'],
    capabilities: ['Runtime inspection'],
  },
  'example-plugin': {
    description:
      'Demonstrate APISIX plugin development patterns with a sample plugin.',
    category: 'Others',
    keywords: ['example', 'plugin development', 'sample'],
    capabilities: ['Development example'],
  },
  'aws-lambda': {
    description:
      'Proxy requests to AWS Lambda functions as dynamic upstreams.',
    category: 'Serverless',
    keywords: ['aws', 'lambda', 'serverless'],
    capabilities: ['AWS Lambda upstream'],
  },
  'azure-functions': {
    description:
      'Proxy requests to Microsoft Azure Functions as dynamic upstreams.',
    category: 'Serverless',
    keywords: ['azure', 'functions', 'serverless'],
    capabilities: ['Azure Functions upstream'],
  },
  openwhisk: {
    description:
      'Integrate APISIX with the Apache OpenWhisk serverless platform.',
    category: 'Serverless',
    keywords: ['openwhisk', 'serverless'],
    capabilities: ['OpenWhisk upstream'],
  },
  openfunction: {
    description:
      'Integrate APISIX with the CNCF OpenFunction serverless platform.',
    category: 'Serverless',
    keywords: ['openfunction', 'serverless', 'cncf'],
    capabilities: ['OpenFunction upstream'],
  },
};

export const getPluginCatalogEntry = (
  name: string
): PluginCatalogEntry | undefined => entries[name];

export const getPluginDescription = (
  name: string,
  schemaDescription?: string
): string | undefined =>
  schemaDescription?.trim() || getPluginCatalogEntry(name)?.description;

export const getPluginSearchText = (
  name: string,
  schemaDescription?: string
): string => {
  const entry = getPluginCatalogEntry(name);
  return [
    name,
    getPluginDescription(name, schemaDescription),
    entry?.category,
    ...(entry?.keywords ?? []),
    ...(entry?.capabilities ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
};
