import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

// Same SharePoint share link used by /api/excel
const ONEDRIVE_SHARE_LINK =
  process.env.ONEDRIVE_SHARE_LINK ||
  'https://aksidcorpcom-my.sharepoint.com/:x:/g/personal/it_aksidcorp_com/IQDgZtT3QuO0RYrrLENNAbWaAacWd46Xo3p0mCC_-SrFOWg?e=c7bfHE';

function toDownloadUrl(link: string): string {
  if (link.includes('download=1')) return link;
  if (link.includes('sharepoint.com') || link.includes('onedrive.live.com'))
    return link.includes('?') ? link + '&download=1' : link + '?download=1';
  return link;
}

function num(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

// Find a column index from a headers array using partial name matching
function findCol(headers: string[], ...candidates: string[]): number {
  for (const c of candidates) {
    const idx = headers.findIndex(h => h.includes(c));
    if (idx >= 0) return idx;
  }
  return -1;
}

export async function GET() {
  try {
    // ── 1. Fetch Excel from SharePoint ──────────────────
    const downloadUrl = toDownloadUrl(ONEDRIVE_SHARE_LINK);
    const response = await fetch(downloadUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AKSID-Dashboard/1.0)' },
      redirect: 'follow',
      cache: 'no-store',
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `SharePoint fetch failed: ${response.status} ${response.statusText}` },
        { status: 502 }
      );
    }

    const buffer = await response.arrayBuffer();

    // ── 2. Parse workbook ───────────────────────────────
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });

    // Try Sheet3 first (Make.com writes here), then fall back to first sheet
    const sheetName = wb.SheetNames.includes('Sheet3')
      ? 'Sheet3'
      : wb.SheetNames[0];

    const ws = wb.Sheets[sheetName];
    if (!ws) {
      return NextResponse.json({ error: 'No sheets found in workbook' }, { status: 500 });
    }

    // Get as array-of-arrays; first row = headers
    const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    if (raw.length < 2) {
      return NextResponse.json({ rows: [], updated: new Date().toISOString() });
    }

    // ── 3. Build header map (lowercase, no spaces) ──────
    const headers = (raw[0] as unknown[]).map(h =>
      String(h ?? '').toLowerCase().replace(/[\s_\-\/]+/g, '')
    );

    // Column indices
    const iDate       = findCol(headers, 'date', 'tripdate');
    const iDriver     = findCol(headers, 'driver', 'drivername', 'name');
    const iDept       = findCol(headers, 'dept', 'department');
    const iVehicle    = findCol(headers, 'vehicle', 'reg', 'registration');
    const iKmStart    = findCol(headers, 'kmstart', 'startk', 'startkm');
    const iKmEnd      = findCol(headers, 'kmend', 'endk', 'endkm');
    const iKm         = findCol(headers, 'totalkm', 'km', 'distance');
    const iFuel       = findCol(headers, 'fuelcost', 'fuel');
    const iToll       = findCol(headers, 'toll', 'tollcost');
    const iFood       = findCol(headers, 'food', 'foodbill');
    const iMaint      = findCol(headers, 'maint', 'maintenance');
    const iParking    = findCol(headers, 'park', 'parking', 'carpark');
    const iHotel      = findCol(headers, 'hotel');
    const iFine       = findCol(headers, 'fine', 'police');
    const iOthers     = findCol(headers, 'others', 'othercost');
    const iTotal      = findCol(headers, 'total');
    const iBillFrom   = findCol(headers, 'billfrom', 'periodfrom', 'from');
    const iBillTo     = findCol(headers, 'billto', 'periodto', 'to');
    const iMonth      = findCol(headers, 'month');
    const iStatus     = findCol(headers, 'status');
    const iRemarks    = findCol(headers, 'remark', 'note', 'notes');

    // ── 4. Map rows ─────────────────────────────────────
    const rows = [];

    for (let i = 1; i < raw.length; i++) {
      const r = raw[i] as unknown[];
      if (!r) continue;

      // Skip completely empty rows
      const hasContent = r.some(v => v != null && v !== '');
      if (!hasContent) continue;

      const fuel        = num(iFuel        >= 0 ? r[iFuel]      : 0);
      const toll        = num(iToll       >= 0 ? r[iToll]      : 0);
      const food        = num(iFood       >= 0 ? r[iFood]      : 0);
      const maintenance = num(iMaint      >= 0 ? r[iMaint]     : 0);
      const parking     = num(iParking    >= 0 ? r[iParking]   : 0);
      const hotel       = num(iHotel      >= 0 ? r[iHotel]     : 0);
      const fine        = num(iFine       >= 0 ? r[iFine]      : 0);
      const others      = num(iOthers     >= 0 ? r[iOthers]    : 0);
      const kmStart     = num(iKmStart    >= 0 ? r[iKmStart]   : 0);
      const kmEnd       = num(iKmEnd      >= 0 ? r[iKmEnd]     : 0);
      let   km          = num(iKm        >= 0 ? r[iKm]        : 0);
      let   total       = num(iTotal     >= 0 ? r[iTotal]     : 0);

      if (!km && kmEnd > kmStart) km = kmEnd - kmStart;
      if (!total) total = fuel + toll + food + maintenance + parking + hotel + fine + others;

      // Date handling — Excel serial numbers or ISO strings
      const dateRaw = iDate >= 0 ? r[iDate] : null;
      let dateObj: Date | null = null;
      let _dateStr = '';
      let _dateNum = 0;

      if (dateRaw instanceof Date) {
        dateObj = dateRaw;
      } else if (typeof dateRaw === 'number' && dateRaw > 40000) {
        const parsed = XLSX.SSF.parse_date_code(dateRaw);
        if (parsed) dateObj = new Date((parsed as any).y, (parsed as any).m - 1, (parsed as any).d);
      } else if (typeof dateRaw === 'string' && dateRaw) {
        dateObj = new Date(dateRaw);
        if (isNaN(dateObj.getTime())) dateObj = null;
      }

      if (dateObj && !isNaN(dateObj.getTime())) {
        _dateStr = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        _dateNum = dateObj.getTime();
      } else {
        _dateStr = str(dateRaw);
      }

      // Month label
      let month = iMonth >= 0 ? str(r[iMonth]) : '';
      if (!month && dateObj && !isNaN(dateObj.getTime())) {
        month = dateObj.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      }

      rows.push({
        date:        dateRaw,
        _dateStr,
        _dateNum,
        driver:      str(iDriver   >= 0 ? r[iDriver]   : ''),
        dept:        str(iDept     >= 0 ? r[iDept]     : ''),
        vehicle:     str(iVehicle  >= 0 ? r[iVehicle]  : ''),
        kmStart,
        kmEnd,
        km,
        fuel,
        toll,
        food,
        maintenance,
        parking,
        hotel,
        fine,
        others,
        total,
        month,
        billFrom:    str(iBillFrom >= 0 ? r[iBillFrom] : ''),
        billTo:      str(iBillTo   >= 0 ? r[iBillTo]   : ''),
        status:      str(iStatus   >= 0 ? r[iStatus]   : 'Pending Review') || 'Pending Review',
        remarks:     str(iRemarks  >= 0 ? r[iRemarks]  : ''),
      });
    }

    return NextResponse.json(
      { rows, updated: new Date().toISOString(), sheet: sheetName, count: rows.length },
      { headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } }
    );
  } catch (err) {
    console.error('[/api/data] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
