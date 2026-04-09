import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import './index.css';
import App from './App.tsx';

const theme = createTheme({
  typography: {
    fontFamily: 'IBM Plex Sans, sans-serif',
    h4: {
      fontFamily: 'Space Grotesk, sans-serif',
    },
    h6: {
      fontFamily: 'Space Grotesk, sans-serif',
    },
  },
  palette: {
    mode: 'dark',
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>
);
