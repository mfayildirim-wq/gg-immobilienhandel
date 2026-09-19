import re, pathlib, sys
# EINMALIG: hat die Erstfassung von packages/db/src/schema.ts erzeugt. Nicht erneut ausführen, schema.ts ist jetzt die Quelle.
src = pathlib.Path('/Users/fatih/Documents/ivtag/protokoll/werkzeuge/er_gen.py').read_text()
head = src[:src.index('\nHEADER_NOTE')]
ns = {}
exec(head.split('\nT = {',1)[0].split('import html, json, pathlib, re',1)[1], ns)  # STD, KIND
exec('T = {' + head.split('\nT = {',1)[1], ns)
T = ns['T']

FK = {'objekt_id':'objekte','makler_id':'makler','deal_id':'deals','deal_einheit_id':'dealEinheiten',
      'objekt_einheit_id':'objektEinheiten','praesentation_id':'finanzpraesentationen','liste_id':'vertriebslisten',
      'projekt_id':'projekte','projekt_einheit_id':'projektEinheiten','vorlage_typ':'begleitscheinVorlagen','vordruck_id':'vordrucke'}
FK_COL = {'vorlage_typ':'typ'}
# Kind-Tabellen: beim Löschen des Elternteils mitlöschen (Komposition)
CASCADE = {('makler_kommunikation','makler_id'),('objekt_einheiten','objekt_id'),('objekt_fotos','objekt_id'),
  ('deal_einheiten','deal_id'),('deal_status_historie','deal_id'),('deal_sanierungen','deal_id'),('deal_kommentare','deal_id'),
  ('deal_kalk_varianten','deal_id'),('deal_dokumente','deal_id'),('praesentation_folien','praesentation_id'),
  ('vertriebsliste_zeilen','liste_id'),('projekt_einheiten','projekt_id'),('projekt_mieterhistorie','projekt_einheit_id'),
  ('projekt_aufgaben','projekt_id'),('projekt_gebaeude_massnahmen','projekt_id'),('begleitschein_aktionen','vorlage_typ')}

def camel(s):
    p = s.split('_'); return p[0] + ''.join(x[:1].upper()+x[1:] for x in p[1:])

used = set()
def coltype(name, typ, table):
    base = typ.split(' · ')[0].strip()
    if base == 'text[]': used.add('text'); return f"text('{name}').array()"
    m = re.match(r'numeric\((\d+),(\d+)\)', base)
    if m: used.add('numeric'); return f"numeric('{name}', {{ precision: {m[1]}, scale: {m[2]}, mode: 'number' }})"
    mp = {'text':"text('{n}')", 'jsonb':"jsonb('{n}')", 'date':"date('{n}')",
          'timestamptz':"timestamp('{n}', {{ withTimezone: true, mode: 'string' }})",
          'int':"integer('{n}')", 'bigint':"bigint('{n}', {{ mode: 'number' }})", 'bool':"boolean('{n}')",
          'double':"doublePrecision('{n}')"}
    fn = mp[base].split('(')[0]; used.add(fn)
    return mp[base].format(n=name)

order = list(T.keys())
out = []
for tname, rows in T.items():
    v = camel(tname)
    cols = []; pks = [r for r in rows if isinstance(r, tuple) and 'PK' in r[0]]
    composite = len(pks) > 1
    extras = []
    for k, col, typ in rows:
        if col.startswith('⊕'):
            used.update(['timestamp','integer'])
            cols += ["  ...standardSpalten,"]; continue
        if col.startswith('◦'):
            cols += ["  ...zeitSpalten,"]; continue
        expr = coltype(col, typ, tname)
        opt = 'optional' in typ
        if 'PK' in k:
            if typ.split(' · ')[0] in ('int','bigint') :
                expr += '.primaryKey().generatedAlwaysAsIdentity()'
            elif not composite:
                expr += '.primaryKey()'
            else:
                expr += '.notNull()'
        elif 'FK' in k:
            ref = FK[col]; refcol = FK_COL.get(col, 'id')
            if not opt: expr += '.notNull()'
            ondel = "{ onDelete: 'cascade' }" if (tname, col) in CASCADE else ("{ onDelete: 'set null' }" if opt else '')
            expr += f".references((): AnyPgColumn => {ref}.{camel(refcol)}{', ' + ondel if ondel else ''})"
        elif 'unique' in typ:
            expr += '.unique()'
        if tname == 'deals' and col == 'status':
            expr += ".notNull().default(START_STATUS)"
        if col in ('am','hochgeladen_am','gesehen_am') or (col=='created_at'):
            expr += '.notNull().defaultNow()'
        elif col == 'zeitpunkt':  # Altbestand ohne Zeitangabe bleibt leer (07, Zuordnung)
            expr += '.defaultNow()'
        cols.append(f"  {camel(col)}: {expr},")
    body = '\n'.join(cols)
    third = []
    if composite:
        third.append(f"primaryKey({{ columns: [t.{camel(pks[0][1])}, t.{camel(pks[1][1])}] }})"); used.add('primaryKey')
    if tname == 'deals':
        third += ["check('deals_status_check', sql`${t.status} in (${sql.raw(DEAL_STATUS.map((s) => `'${s}'`).join(', '))})`)",
                  "index('deals_status_idx').on(t.status).where(sql`${t.deletedAt} is null`)",
                  "index('deals_next_contact_idx').on(t.nextContact).where(sql`${t.deletedAt} is null`)",
                  "index('deals_objekt_idx').on(t.objektId)", "index('deals_makler_idx').on(t.maklerId)"]
    if tname == 'deal_status_historie':
        third += ["check('deal_status_historie_nach_check', sql`${t.nachStatus} in (${sql.raw(DEAL_STATUS.map((s) => `'${s}'`).join(', '))})`)",
                  "index('deal_status_historie_deal_idx').on(t.dealId, t.am)"]
    if tname == 'objekte':
        third += ["index('objekte_stadt_idx').on(t.stadt).where(sql`${t.deletedAt} is null`)"]
    if tname == 'makler':
        third += ["index('makler_next_contact_idx').on(t.nextContact).where(sql`${t.deletedAt} is null`)"]
    if third:
        out.append(f"export const {v} = fach\n  .table(\n    '{tname}',\n    {{\n" + body.replace('\n  ', '\n      ').replace('  ...','      ...',1) + f"\n    }},\n    (t) => [\n      " + ',\n      '.join(third) + ",\n    ],\n  )\n  .enableRLS();\n")
    else:
        out.append(f"export const {v} = fach\n  .table('{tname}', {{\n" + body + "\n  })\n  .enableRLS();\n")

imports = sorted(used | {'pgSchema','type AnyPgColumn','index','check'} - {'primaryKey'} ) 
imports = sorted(set(imports) | ({'primaryKey'} if 'primaryKey' in used else set()), key=lambda s: s.replace('type ',''))
hdr = f"""// Zielschema „fach“ (Protokoll 07 · 37 Tabellen), erzeugt aus protokoll/werkzeuge/er_gen.py
// durch scripts/schema-aus-protokoll.py. Änderungen hier vornehmen, danach `pnpm db:generate`.
import {{ sql }} from 'drizzle-orm';
import {{
  {', '.join(imports)},
}} from 'drizzle-orm/pg-core';
import {{ DEAL_STATUS, START_STATUS }} from '@gg/domain';

export const fach = pgSchema('fach');

/** created_at · updated_at · deleted_at · version (07, Regeln 5 und 6) */
const standardSpalten = {{
  createdAt: timestamp('created_at', {{ withTimezone: true, mode: 'string' }}).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', {{ withTimezone: true, mode: 'string' }}).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', {{ withTimezone: true, mode: 'string' }}),
  version: integer('version').notNull().default(1),
}};

/** created_at · updated_at für Kind-Tabellen */
const zeitSpalten = {{
  createdAt: timestamp('created_at', {{ withTimezone: true, mode: 'string' }}).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', {{ withTimezone: true, mode: 'string' }}).notNull().defaultNow(),
}};

"""
pathlib.Path(sys.argv[1]).write_text(hdr + '\n'.join(out))
print(len(T), 'Tabellen')
