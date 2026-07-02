'use client';
import { useState, useRef } from 'react';

const DRIVERS = [
  'Sumon Khan',
  'Md Hanif',
  'Mohammad Islam',
  'Md Sabuz Miah',
  'Md Masud Rana',
  'Shaha Alom',
  'Shahidul Islam',
  'Md. Liton',
];

const VEHICLES = [
  'D.M-GA-49-2639',
  'D.M-GA-11-2019',
  'D.M-GA-14-3971',
  'Other',
];

function today() {
  return new Date().toISOString().split('T')[0];
}

export default function SubmitPage() {
  const [driverName, setDriverName] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [date, setDate] = useState(today());
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle'|'uploading'|'processing'|'done'|'error'>('idle');
  const [result, setResult] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFiles = (newFiles: FileList | null) => {
    if (!newFiles) return;
    const arr = Array.from(newFiles).slice(0, 50);
    setFiles(prev => [...prev, ...arr].slice(0, 50));
    arr.forEach(f => {
      const reader = new FileReader();
      reader.onload = e => setPreviews(p => [...p, e.target?.result as string]);
      reader.readAsDataURL(f);
    });
  };

  const removeFile = (i: number) => {
    setFiles(f => f.filter((_, idx) => idx !== i));
    setPreviews(p => p.filter((_, idx) => idx !== i));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!driverName) return alert('Please select your name');
    if (files.length === 0) return alert('Please add at least one photo');

    setStatus('uploading');
    setErrorMsg('');

    try {
      const formData = new FormData();
      formData.append('driver_name', driverName);
      formData.append('vehicle_no', vehicleNo);
      formData.append('date', date);
      formData.append('bill_period_from', periodFrom || date);
      formData.append('bill_period_to', periodTo || date);
      files.forEach((f, i) => formData.append(`image_${i}`, f));

      setStatus('processing');
      // Abort after 60s so the app never hangs silently on a stuck request.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      let res: Response;
      try {
        res = await fetch('/api/submit', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });
      } catch (e: any) {
        if (e.name === 'AbortError') {
          throw new Error('Server took too long. Check your connection and try again with fewer/smaller photos.');
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }

      // Read as text first so a non-JSON error page (e.g. a 500 or timeout)
      // shows a clear message instead of iOS Safari's cryptic
      // "The string did not match the expected pattern."
      const rawText = await res.text();
      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(
          `Server error (${res.status}). The submission service returned an unexpected response — ` +
          `this usually means the server keys (GitHub / AI) are not configured yet. ` +
          `Details: ${rawText.slice(0, 120)}`
        );
      }
      if (!res.ok) throw new Error(data.error || `Submission failed (${res.status})`);

      setResult(data);
      setStatus('done');
    } catch (err: any) {
      setErrorMsg(err.message);
      setStatus('error');
    }
  };

  if (status === 'done' && result) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 56 }}>✅</div>
            <h2 style={{ color: '#16a34a', margin: '8px 0' }}>Submitted!</h2>
            <p style={{ color: '#6b7280' }}>Your transport expense has been recorded</p>
          </div>

          <div style={styles.summaryBox}>
            <Row label="Driver" value={result.entry?.driver_name} />
            <Row label="Department" value={result.entry?.department} />
            <Row label="Date" value={result.entry?.date} />
            <Row label="Vehicle" value={result.entry?.vehicle_no} />
            <Row label="Total KM" value={result.entry?.total_km ? `${result.entry.total_km} km` : '—'} />
            <Row label="Fuel" value={result.entry?.fuel_cost ? `৳${result.entry.fuel_cost}` : '—'} />
            <Row label="Toll" value={result.entry?.toll ? `৳${result.entry.toll}` : '—'} />
            <Row label="Food" value={result.entry?.food_bill ? `৳${result.entry.food_bill}` : '—'} />
            <Row label="Others" value={result.entry?.others ? `৳${result.entry.others}` : '—'} />
            <Row label="Photos" value={`${result.total_images} submitted`} />
          </div>

          {result.undetected_fields?.length > 0 && (
            <div style={styles.warnBox}>
              <strong>⚠️ Could not read:</strong>
              <ul style={{ margin: '4px 0 0 0', paddingLeft: 18 }}>
                {result.undetected_fields.map((f: string, i: number) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          )}

          <p style={{ textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
            Admin has been notified by email ✉️
          </p>

          <button style={styles.btn} onClick={() => {
            setStatus('idle'); setFiles([]); setPreviews([]); setResult(null);
            setDriverName(''); setVehicleNo(''); setDate(today());
          }}>
            Submit Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 40 }}>⛽</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '8px 0 4px' }}>
            AKSID Transport Expense
          </h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>
            Submit your bills & receipts
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Driver Name */}
          <Label>Your Name *</Label>
          <select value={driverName} onChange={e => setDriverName(e.target.value)} style={styles.input} required>
            <option value="">Select your name</option>
            {DRIVERS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>

          {/* Vehicle */}
          <Label>Vehicle Number</Label>
          <select value={vehicleNo} onChange={e => setVehicleNo(e.target.value)} style={styles.input}>
            <option value="">Select vehicle</option>
            {VEHICLES.map(v => <option key={v} value={v}>{v}</option>)}
          </select>

          {/* Date */}
          <Label>Date *</Label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={styles.input} required />

          {/* Bill Period */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <Label>Period From</Label>
              <input type="date" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} style={styles.input} />
            </div>
            <div>
              <Label>Period To</Label>
              <input type="date" value={periodTo} onChange={e => setPeriodTo(e.target.value)} style={styles.input} />
            </div>
          </div>

          {/* Photo Upload */}
          <Label>Photos ({files.length}/50) *</Label>
          <div
            style={styles.uploadZone}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
          >
            <div style={{ fontSize: 36 }}>📷</div>
            <p style={{ margin: '8px 0 4px', fontWeight: 600 }}>Tap to add photos</p>
            <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>
              Fuel receipts, toll slips, food bills, maintenance — up to 50 photos
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            style={{ display: 'none' }}
            onChange={e => handleFiles(e.target.files)}
          />

          {/* Previews */}
          {previews.length > 0 && (
            <div style={styles.previewGrid}>
              {previews.map((src, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={src} alt={`photo ${i+1}`} style={styles.previewImg} />
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    style={styles.removeBtn}
                  >×</button>
                </div>
              ))}
            </div>
          )}

          {/* Submit */}
          {status === 'error' && (
            <div style={styles.errorBox}>{errorMsg}</div>
          )}

          <button
            type="submit"
            style={{ ...styles.btn, opacity: (status === 'processing' || status === 'uploading') ? 0.7 : 1 }}
            disabled={status === 'processing' || status === 'uploading'}
          >
            {status === 'uploading' ? '📤 Uploading...' :
             status === 'processing' ? '🤖 AI Processing...' :
             '✅ Submit Bill'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: '14px 0 5px', fontSize: 13, fontWeight: 600, color: '#374151' }}>{children}</p>;
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
      <span style={{ color: '#6b7280', fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: 600, fontSize: 13 }}>{value || '—'}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '16px 12px 40px',
  },
  card: {
    background: '#fff',
    borderRadius: 20,
    padding: '28px 20px',
    width: '100%',
    maxWidth: 480,
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '1.5px solid #e5e7eb',
    borderRadius: 10,
    fontSize: 15,
    background: '#fafafa',
    boxSizing: 'border-box',
    outline: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
  } as React.CSSProperties,
  uploadZone: {
    border: '2px dashed #60a5fa',
    borderRadius: 12,
    padding: '24px 16px',
    textAlign: 'center',
    background: '#eff6ff',
    cursor: 'pointer',
  },
  previewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 8,
    marginTop: 12,
  },
  previewImg: {
    width: '100%',
    aspectRatio: '1',
    objectFit: 'cover',
    borderRadius: 8,
  },
  removeBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: '#ef4444',
    color: '#fff',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    lineHeight: '20px',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btn: {
    width: '100%',
    padding: '14px',
    background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: 20,
  },
  summaryBox: {
    background: '#f9fafb',
    borderRadius: 12,
    padding: '12px 16px',
    marginBottom: 16,
  },
  warnBox: {
    background: '#fef3c7',
    border: '1px solid #fcd34d',
    borderRadius: 10,
    padding: '10px 14px',
    fontSize: 13,
    marginBottom: 16,
  },
  errorBox: {
    background: '#fee2e2',
    border: '1px solid #fca5a5',
    borderRadius: 10,
    padding: '10px 14px',
    fontSize: 13,
    color: '#dc2626',
    marginBottom: 12,
  },
};
