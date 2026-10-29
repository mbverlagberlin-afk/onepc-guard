'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Kleiner JSON-Speicher für Einstellungen. Schreibt atomar über eine temporäre Datei.
 */
class Store {
    constructor(file, defaults = {}) {
        this.file = file;
        this.data = { ...defaults };
        try {
            Object.assign(this.data, JSON.parse(fs.readFileSync(file, 'utf8')));
        } catch {
            // Erste Ausführung oder beschädigte Datei: mit Standardwerten beginnen.
        }
    }

    get(key) {
        return this.data[key];
    }

    set(key, value) {
        if (value === undefined) {
            delete this.data[key];
        } else {
            this.data[key] = value;
        }
        this.save();
    }

    save() {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
        fs.renameSync(tmp, this.file);
    }
}

module.exports = { Store };
