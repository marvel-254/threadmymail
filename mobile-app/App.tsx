import { StatusBar } from 'expo-status-bar';
import { AppShell } from './src/AppShell';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';

function ThemedApp() {
  const { resolved } = useTheme();
  return (
    <>
      <AppShell />
      <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  );
}
