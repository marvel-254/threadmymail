import { FlexWidget, TextWidget } from 'react-native-android-widget';

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
  const statusColor = busy || killSwitch
    ? '#FCA5A5'
    : shadowMode
      ? '#FCD34D'
      : '#67E8F9';
  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        height: 'match_parent',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: '#0B1326',
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
          style={{ fontSize: 13, fontWeight: '700', color: '#A78BFA' }}
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
            style={{ fontSize: 32, fontWeight: '700', color: '#F8FAFC' }}
          />
          <TextWidget
            text="need your eye"
            style={{ fontSize: 11, color: '#94A3B8' }}
          />
        </FlexWidget>
        <FlexWidget
          clickAction="OPEN_APP"
          style={{ flexDirection: 'column' }}
        >
          <TextWidget
            text={String(unread)}
            style={{ fontSize: 32, fontWeight: '700', color: '#F8FAFC' }}
          />
          <TextWidget
            text="unread"
            style={{ fontSize: 11, color: '#94A3B8' }}
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
            backgroundColor: '#7C3AED',
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
            borderColor: killSwitch ? '#FCA5A5' : '#334155',
          }}
        >
          <TextWidget
            text={killSwitch ? 'Resume' : 'Pause'}
            style={{
              fontSize: 12,
              fontWeight: '600',
              color: killSwitch ? '#FCA5A5' : '#CBD5E1',
            }}
          />
        </FlexWidget>
      </FlexWidget>
      {summary ? (
        <TextWidget
          text={summary}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 10, color: '#94A3B8', width: 'match_parent' }}
        />
      ) : null}
    </FlexWidget>
  );
}
