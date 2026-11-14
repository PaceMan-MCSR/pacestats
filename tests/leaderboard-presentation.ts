import assert from "node:assert/strict";
import {createLeaderboardModel} from "../app/components/tables/leaderboardModel";
import {CategoryType} from "../app/utils";

const entry = {uuid: "player-one", name: "COVlD19", qty: 4, avg: 123456, value: 123456, ignoredRunPayload: "never serialize me"};
const data = {
    [CategoryType.COUNT]: {nether: [entry], bastion: [entry], first_structure: [entry]},
    [CategoryType.AVG]: {nether: [entry], bastion: [entry], first_structure: [entry]},
    [CategoryType.FASTEST]: {nether: [{...entry, runId: 42}], finish: [entry]},
    [CategoryType.CONVERSION]: {nether: [entry], finish: [{...entry, value: 12.345}]},
};
const users = [{uuid: "player-one", color: "123abc"}, {uuid: "unused-player", color: "ffffff"}];
const combined = createLeaderboardModel(data, users, 30, "count_avg", false);
assert.deepEqual(combined.players, [{name: "jojoe77777", uuid: "player-one", color: "#123abc"}]);
assert.deepEqual(combined.boards.map(board => board.id), ["nether-quantity", "nether-average", "first_structure-quantity", "first_structure-average"]);
assert.equal(combined.boards[0].rows[0].value, "4");
assert.equal(combined.boards[0].rows[0].hint, "2:03");
assert.equal(combined.boards[1].rows[0].value, "2:03.4");
assert.equal(combined.boards[1].help, "Sample size: 200–700");
assert.equal(combined.boards[1].rows[0].quantity, 4);
assert.ok(!JSON.stringify(combined).includes("never serialize me"));
assert.ok(!JSON.stringify(combined).includes("unused-player"));

const separate = createLeaderboardModel(data, users, 7, "average", true);
assert.deepEqual(separate.boards.map(board => board.id), ["nether-average", "bastion-average"]);
const fastest = createLeaderboardModel(data, [], 30, "fastest", false);
assert.deepEqual(fastest.boards.map(board => board.id), ["nether-fastest", "finish-fastest"]);
assert.equal(fastest.boards[0].rows[0].runId, 42);
assert.equal(fastest.boards[1].rows[0].runId, undefined, "Missing run metadata must not produce a phantom run link");
assert.equal(fastest.players[0].color, "#e6e6e6");
const conversion = createLeaderboardModel(data, users, 30, "conversion", false);
assert.deepEqual(conversion.boards.map(board => board.id), ["finish-conversion"], "Nether has no conversion table");
assert.equal(conversion.boards[0].rows[0].value, "12.3%");
assert.deepEqual(createLeaderboardModel({}, [], 30, "count_avg", false), {players: [], boards: []});

const many = Array.from({length: 15}, (_, index) => ({...entry, uuid: `p${index}`}));
assert.equal(createLeaderboardModel({[CategoryType.COUNT]: {nether: many}}, [], 30, "count_avg", false).boards[0].rows.length, 10);
const aaAverage = createLeaderboardModel(data, users, 7, "average", false, true);
assert.equal(aaAverage.aa, true);
assert.deepEqual(aaAverage.boards.map(board => board.id), ["nether-average", "bastion-average"]);
assert.deepEqual(aaAverage.boards[0].sample, {minimum: 5, good: 10, left: "#ff0000", right: "#00FF00"});
const aaFastest = createLeaderboardModel(data, users, 7, "fastest", false, true);
assert.equal(aaFastest.boards[0].rows[0].runId, undefined, "AA times do not link to normal-run IDs");
assert.equal(aaFastest.players.length, 1, "AA views serialize only identities they display");
assert.equal(aaFastest.boards.every(board => board.kind === "fastest"), true);
console.log("PASS: selected leaderboard models preserve values, split modes, identities and missing-run fallbacks without unrelated payloads");
