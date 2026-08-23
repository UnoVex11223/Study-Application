import { createContext, useContext } from "react";

// App-wide state + actions, provided by App.jsx.
export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export const GRADS = [
  "linear-gradient(135deg,#0575e6,#021b79)", "linear-gradient(135deg,#00b09b,#96c93d)",
  "linear-gradient(135deg,#667eea,#764ba2)", "linear-gradient(135deg,#f7971e,#ffd200)",
  "linear-gradient(135deg,#f953c6,#b91d73)", "linear-gradient(135deg,#4facfe,#00f2fe)",
  "linear-gradient(135deg,#ff6b6b,#ee0979)", "linear-gradient(135deg,#11998e,#38ef7d)",
  "linear-gradient(135deg,#f46b45,#eea849)", "linear-gradient(135deg,#4776e6,#8e54e9)",
  "linear-gradient(135deg,#232526,#414345)", "linear-gradient(135deg,#00c9ff,#92fe9d)",
];
