import { FlexWidget, TextWidget } from 'react-native-android-widget';

/**
 * Home-screen widget. Uses static colors (hardcoded here) because Android
 * widgets are rendered by the system outside the app process — they cannot
 * read the JS palette proxy. These values mirror the Nordic tokens in
 * theme.ts.
 *
 * Note on secrets: no credentials, no PII, only counts + status.
 */

export type MilloWidgetData = {
  unread: number;
  needsEye: number;
  killSwitch: boolean;
  shadowMode: boolean;
  busy?: boolean;
  summary?: string | null;
};

export function MilloWidget({
  unread,
  needsEye,
  killSwitch,
  shadowMode,
  busy = false,
  summary,
}: MilloWidgetData) {
  const status = busy
    ? 'TRIAGING'
    : killSwitch
      ? 'PAUSED'
      : shadowMode
        ? 'SHADOW'
        : 'WATCHING';

  // Nordic status colors — warm, distinctive palette to match the app.
  const statusColor = busy || killSwitch
    ? '#FFCDD2'    // dangerText on dark
    : shadowMode
      ? '#FFE0B2'  // warnText
      : '#A7F3D0'; // successText

  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        height: 'match_parent',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: '#000000', // pure OLED black
        borderRadius: 20,
        padding: 14,
      }}
    >
      <FlexWidget
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <TextWidget
          text="MILLO"
          style={{ fontSize: 13, fontWeight: '700', color: '#FFB4A8' }}
        />
        <TextWidget
          text={status}
          style={{ fontSize: 11, fontWeight: '700', color: statusColor }}
        />
      </FlexWidget>

      <FlexWidget style={{ flexDirection: 'row', flexGap: 22, alignItems: 'center' }}>
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={{ uri: 'threadmymail://today?focus=needs-eye' }}
          style={{ flexDirection: 'column' }}
        >
          <TextWidget
            text={String(needsEye)}
            style={{ fontSize: 32, fontWeight: '700', color: '#F2F2F2' }}
          />
          <TextWidget
            text="need your eye"
            style={{ fontSize: 11, color: '#A0A0A0' }}
          />
        </FlexWidget>
        <FlexWidget
          clickAction="OPEN_APP"
          style={{ flexDirection: 'column' }}
        >
          <TextWidget
            text={String(unread)}
            style={{ fontSize: 32, fontWeight: '700', color: '#F2F2F2' }}
          />
          <TextWidget
            text="unread"
            style={{ fontSize: 11, color: '#A0A0A0' }}
          />
        </FlexWidget>
      </FlexWidget>

      <FlexWidget style={{ flexDirection: 'row', flexGap: 10, alignItems: 'center' }}>
        <FlexWidget
          clickAction="RUN_TRIAGE"
          style={{
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: 10,
            backgroundColor: '#EA2B16', // Nordic flame primary accent
          }}
        >
          <TextWidget
            text={busy ? 'Triaging…' : 'Run triage'}
            style={{ fontSize: 12, fontWeight: '600', color: '#FFFFFF' }}
          />
        </FlexWidget>
        <FlexWidget
          clickAction="TOGGLE_KILL"
          style={{
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: killSwitch ? '#FFCDD2' : '#3A3A3A',
          }}
        >
          <TextWidget
            text={killSwitch ? 'Resume' : 'Pause'}
            style={{
              fontSize: 12,
              fontWeight: '600',
              color: killSwitch ? '#FFCDD2' : '#F2F2F2',
            }}
          />
        </FlexWidget>
      </FlexWidget>
      {summary ? (
        <TextWidget
          text={summary}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 10, color: '#A0A0A0', width: 'match_parent' }}
        />
      ) : null}
    </FlexWidget>
  );
}