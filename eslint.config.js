import ts from "typescript-eslint";
export default ts.config(
  { ignores: ["dist/**", "web-dist/**", "node_modules/**"] },
  ...ts.configs.recommended,
  { rules: { "@typescript-eslint/no-explicit-any": "off" } },
);
