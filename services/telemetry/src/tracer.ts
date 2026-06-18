import { trace, type Tracer } from '@opentelemetry/api';

/**
 * The name and version advertised in the `instrumentationLibrary` of every
 * span started by the DMR-X gateway, router, and adapter base. They are also
 * what `trace.getTracer(TRACER_NAME, TRACER_VERSION)` returns from
 * `services/telemetry/src/tracer.ts`.
 *
 * Keeping these as constants makes them easy to override from a test
 * (re-import with a different name) and easy to grep for when a trace
 * arrives in the collector.
 */
export const TRACER_NAME = 'dmr-x-gateway';
export const TRACER_VERSION = '0.4.0';

/**
 * The DMR-X gateway tracer.
 *
 * This is the OTel `Tracer` instance that all gateway code uses to start
 * spans (`tracer.startActiveSpan('http.request', ...)` etc.). It is
 * obtained from the *global* tracer provider, which is configured in two
 * places:
 *
 *  - **Production**: `TelemetryService.start()` (in
 *    `services/telemetry/src/telemetry.service.ts`) initialises a
 *    `NodeSDK` with an `OTLPTraceExporter`, which registers itself as
 *    the global provider. The SDK's default propagator is W3C
 *    `traceparent`, so `traceparent` headers are injected automatically
 *    on outbound `fetch` calls once we are inside an active span.
 *
 *  - **Tests**: `installInMemoryTracerProvider()` (below) registers an
 *    in-memory provider so spans can be asserted on without a real
 *    collector.
 *
 * Until one of those two has run, `tracer` is a `ProxyTracer` that the
 * OTel API resolves lazily — so it is always safe to import this module
 * and call `tracer.startActiveSpan(...)`, even before the SDK has
 * started. Spans simply go to a no-op provider until then.
 */
export const tracer: Tracer = trace.getTracer(TRACER_NAME, TRACER_VERSION);
