import { createContext, useContext } from "react";

type SidebarContextValue = {
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
};

export const SidebarContext = createContext<SidebarContextValue>({
  isCollapsed: false,
  setIsCollapsed: () => {},
});

export const useSidebarContext = () => useContext(SidebarContext);

