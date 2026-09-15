import { createContext, useContext } from "react";
const ThemeContext = createContext({ theme: "dark", setTheme: (_theme: string) => {} });
export function ThemeProvider({ children, defaultTheme = "dark" }: { children: React.ReactNode; defaultTheme?: string }) { return <ThemeContext.Provider value={{ theme: defaultTheme, setTheme: () => {} }}>{children}</ThemeContext.Provider>; }
export const useTheme = () => useContext(ThemeContext);
