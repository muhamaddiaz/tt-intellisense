"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.printers = exports.parsers = exports.languages = void 0;
const parser_1 = require("./parser");
const printer_1 = require("./printer");
const PLUGIN_KEY = "template-toolkit";
exports.languages = [
    {
        name: "TemplateToolkit",
        parsers: [PLUGIN_KEY],
        extensions: [".tt", ".inc"],
        vscodeLanguageIds: ["tt"],
    },
];
exports.parsers = {
    [PLUGIN_KEY]: {
        astFormat: PLUGIN_KEY,
        parse: parser_1.parse,
        preprocess: parser_1.preprocess,
        locStart: (node) => node.index,
        locEnd: (node) => node.index + node.length,
    },
};
exports.printers = {
    [PLUGIN_KEY]: {
        print: printer_1.print,
        embed: printer_1.embed,
        getVisitorKeys: printer_1.getVisitorKeys,
    },
};
