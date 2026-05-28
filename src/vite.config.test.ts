import { describe, expect, it } from "vitest";
import config from "../vite.config";

describe("Vite production build", () => {
  it("uses relative asset paths so Electron can load the file build", () => {
    expect(config.base).toBe("./");
  });
});
