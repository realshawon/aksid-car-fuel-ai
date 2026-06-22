export const metadata = { title: 'AKSID Car Fuel AI' };
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'sans-serif', padding: 24, background: '#f5f5f5' }}>
        {children}
      </body>
    </html>
  );
}
