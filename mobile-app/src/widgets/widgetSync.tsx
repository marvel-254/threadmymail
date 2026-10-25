import { requestWidgetUpdate } from 'react-native-android-widget';
import { MilloWidget } from './MilloWidget';
import { loadWidgetData } from './loadWidgetData';

/** Refresh any Millo widgets after sync, triage, or a guardrail change. */
export async function refreshMilloWidget(): Promise<void> {
  try {
    await requestWidgetUpdate({
      widgetName: 'Millo',
      renderWidget: async () => <MilloWidget {...await loadWidgetData()} />,
    });
  } catch {
    // Widgets are optional; never let a launcher failure break the app.
  }
}
