import { StatusBar } from 'expo-status-bar';
import { AppShell } from './src/AppShell';

export default function App() {
  return (
    <>
      <AppShell />
      <StatusBar style="light" />
    </>
  );
}
