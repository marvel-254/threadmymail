/**
 * EdgeSwipe — invisible left-edge gesture zone that opens the navigation drawer.
 * Android-native pattern: swipe from the left screen edge to reveal the drawer.
 */
import { useRef } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
} from 'react-native';

type EdgeSwipeProps = {
  onOpen: () => void;
  /** Width of the active edge zone in dp. */
  edgeWidth?: number;
};

export function EdgeSwipe({ onOpen, edgeWidth = 24 }: EdgeSwipeProps) {
  const startX = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: (evt) => evt.nativeEvent.locationX <= edgeWidth,
      onMoveShouldSetPanResponderCapture: (evt, gesture) =>
        evt.nativeEvent.locationX <= edgeWidth && Math.abs(gesture.dx) > 8,
      onPanResponderGrant: (_, gesture) => {
        startX.current = gesture.x0;
      },
      onPanResponderRelease: (_, gesture) => {
        // Rightward swipe from the edge opens the drawer.
        if (gesture.dx > 40 && gesture.vx > 200) {
          onOpen();
        }
      },
    })
  ).current;

  return <Animated.View style={styles.zone} {...panResponder.panHandlers} pointerEvents="box-only" />;
}

const styles = StyleSheet.create({
  zone: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 24,
    zIndex: 50,
  },
});
