import Script from 'next/script';

/**
 * Google Analytics 4.
 *
 * Renders nothing unless NEXT_PUBLIC_GA_ID is set, so local development and preview
 * builds never pollute the numbers — and a missing env var degrades to "no analytics"
 * rather than a broken page.
 *
 * `afterInteractive` deliberately: the measurement script must not compete with the
 * page for first paint. Nothing on this site depends on analytics loading.
 */
export function Analytics() {
  const id = process.env.NEXT_PUBLIC_GA_ID;
  if (!id) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${id}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${id}', { anonymize_ip: true });
        `}
      </Script>
    </>
  );
}
