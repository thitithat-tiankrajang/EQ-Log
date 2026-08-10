import { describe, expect, it } from "vitest";
import { parseRemoteJoinTarget } from "../src/pregame";

describe("remote join target parsing", () => {
  it("extracts secure codes from shared join links", () => {
    expect(parseRemoteJoinTarget("https://eq.example/#/public/join?code=AB12CD34EF56")).toEqual({
      code: "AB12CD34EF56",
    });
  });

  it("treats legacy room links and UUIDs as open-join ids", () => {
    const id = "b8a642b6-47d8-44ad-884f-aa2d43a63498";
    expect(parseRemoteJoinTarget(`https://eq.example/#/room/${id}`)).toEqual({ gameId: id });
    expect(parseRemoteJoinTarget(id)).toEqual({ gameId: id });
  });

  it("treats ordinary input as a room code", () => {
    expect(parseRemoteJoinTarget(" ab12-cd34 ")).toEqual({ code: "ab12-cd34" });
  });
});
