export default function Home() {
  return (
    <main>
      <h1>AKSID Car Fuel Bill AI</h1>
      <p>This API processes car fuel bill images sent via WhatsApp and extracts structured data into Excel.</p>
      <h2>Endpoint</h2>
      <p><strong>POST /api/process-bill</strong> — Send image URLs + driver info, get extracted Excel row data back</p>
      <h2>Request body (JSON)</h2>
      <pre style={{ background: '#eee', padding: 12, borderRadius: 8 }}>{`{
  "image_urls": ["https://...jpg"],
  "driver_name": "Md Hanif",
  "date": "2026-05-07",
  "bill_period_from": "2026-05-05",
  "bill_period_to": "2026-05-08",
  "vehicle_no": "D.M-GA-49-2639"
}`}</pre>
    </main>
  );
}
