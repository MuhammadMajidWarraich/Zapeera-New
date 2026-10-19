import { createContext, useContext } from "react";

type SidebarContextValue = {
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  /** Mobile (<lg) drawer state: sidebar is off-canvas unless open. */
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
};

export const SidebarContext = createContext<SidebarContextValue>({
  isCollapsed: false,
  setIsCollapsed: () => {},
  mobileOpen: false,
  setMobileOpen: () => {},
});

export const useSidebarContext = () => useContext(SidebarContext);
