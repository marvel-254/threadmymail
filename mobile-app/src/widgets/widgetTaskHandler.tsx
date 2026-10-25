import { setKillSwitch } from '../lib/guardrails';
import { runTriageFromWidget } from '../lib/agent/triage';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { MilloWidget } from './MilloWidget';
import { loadWidgetData } from './loadWidgetData';

/** Kept in the headless JS runtime so a widget tap can show its last result. */
let lastSummary: string | null = null;

async function render(props: WidgetTaskHandlerProps, busy = false): Promise<void> {
  const data = await loadWidgetData(lastSummary);
  props.renderWidget(<MilloWidget {...data} busy={busy} />);
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      await render(props);
      return;
    case 'WIDGET_CLICK':
      if (props.clickAction === 'RUN_TRIAGE') {
        await render(props, true);
        const result = await runTriageFromWidget();
        lastSummary = result.summary;
        await render(props);
        return;
      }
      if (props.clickAction === 'TOGGLE_KILL') {
        const data = await loadWidgetData(lastSummary);
        await setKillSwitch(!data.killSwitch);
        lastSummary = data.killSwitch ? 'Agent resumed.' : 'Agent paused.';
        await render(props);
        return;
      }
      await render(props);
      return;
    default:
      return;
  }
}
