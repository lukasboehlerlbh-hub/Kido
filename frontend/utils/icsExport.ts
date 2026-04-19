import { Platform, Share, Alert } from 'react-native';

export interface ICSEvent {
  uid: string;
  start: string;   // YYYY-MM-DD
  end: string;     // YYYY-MM-DD exclusive
  summary: string;
  description?: string;
}

export function buildICS(events: ICSEvent[], calName = 'Kido'): string {
  const fmt = (d: string) => d.replace(/-/g, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kido//Kido Co-Parenting//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${calName}`,
    'X-WR-TIMEZONE:Europe/Zurich',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTART;VALUE=DATE:${fmt(e.start)}`,
      `DTEND;VALUE=DATE:${fmt(e.end)}`,
      `SUMMARY:${e.summary}`,
      ...(e.description ? [`DESCRIPTION:${e.description.replace(/\n/g, '\\n')}`] : []),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/** Add N days to a YYYY-MM-DD date string */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

export async function exportICS(content: string, filename: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      // Web: trigger browser download
      const g = globalThis as any;
      const blob = new g.Blob([content], { type: 'text/calendar;charset=utf-8' });
      const url = g.URL.createObjectURL(blob);
      const a = g.document.createElement('a');
      a.href = url;
      a.download = filename;
      g.document.body.appendChild(a);
      a.click();
      g.document.body.removeChild(a);
      g.URL.revokeObjectURL(url);
    } else {
      // Native: write file then share
      const FileSystem = await import('expo-file-system');
      const Sharing = await import('expo-sharing');
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(fileUri, content, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/calendar',
          dialogTitle: 'Kido Kalender exportieren',
          UTI: 'public.calendar-event',
        });
      } else {
        await Share.share({ title: 'Kido Kalender (.ics)', message: content });
      }
    }
  } catch (e: any) {
    Alert.alert('Export fehlgeschlagen', e.message || 'Unbekannter Fehler');
  }
}
