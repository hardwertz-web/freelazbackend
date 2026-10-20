/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Habilita `src/instrumentation.ts` (startup do servidor) no Next 14.
    // É lá que `assertJobsAllowUntokenSafe` barra o app de subir com
    // JOBS_ALLOW_UNTOKEN=1 em produção (Etapa 3.3).
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
