import { IconBriefcase, IconBuildingBank, IconCalculator, IconChecklist, IconTableShare, IconTemplate, IconTrash, IconCopy, IconHistory, IconTool, IconKey, IconDatabaseExport, IconBook, IconShieldLock, IconMail } from '@tabler/icons-react';
import type { ComponentType } from 'react';
import { BegleitscheinEinstellungen } from '../components/begleitschein/BegleitscheinEinstellungen.tsx';
import { PraesentationStandards } from '../components/praesentation/PraesentationStandards.tsx';
import { VertriebslistenEinstellungen } from '../components/VertriebslistenEinstellungen.tsx';
import { M365Einstellungen } from '../components/M365Einstellungen.tsx';
import { FreigabenEinstellungen } from '../components/FreigabenEinstellungen.tsx';
import { AnleitungenEinstellungen } from '../components/AnleitungenEinstellungen.tsx';
import { SicherungEinstellungen } from '../components/SicherungEinstellungen.tsx';
import { ZugaengeEinstellungen } from '../components/ZugaengeEinstellungen.tsx';
import { WerkzeugeEinstellungen } from '../components/WerkzeugeEinstellungen.tsx';
import { AuditEinstellungen } from '../components/AuditEinstellungen.tsx';
import { DublettenEinstellungen } from '../components/DublettenEinstellungen.tsx';
import { PapierkorbEinstellungen } from '../components/PapierkorbEinstellungen.tsx';
import { VorlagenEinstellungen } from '../components/VorlagenEinstellungen.tsx';
import { KalkulationEinstellungen, KundenkalkEinstellungenFormular } from '../pages/EinstellungenSeite.tsx';

/** Unterseiten der Einstellungen: eine Seite je Bereich, als Untermenü in der Seitenleiste. */
export const EINSTELLUNGEN_SEITEN: { pfad: string; label: string; icon: ComponentType<{ size?: number }>; komponente: ComponentType }[] = [
  { pfad: 'kalkulation', label: 'Kalkulation', icon: IconCalculator, komponente: KalkulationEinstellungen },
  { pfad: 'kundenkalkulation', label: 'Kundenkalkulation', icon: IconBriefcase, komponente: KundenkalkEinstellungenFormular },
  { pfad: 'bank-praesentation', label: 'Bank-Präsentation', icon: IconBuildingBank, komponente: PraesentationStandards },
  { pfad: 'vertriebslisten', label: 'Vertriebslisten', icon: IconTableShare, komponente: VertriebslistenEinstellungen },
  { pfad: 'begleitscheine', label: 'Begleitscheine', icon: IconChecklist, komponente: BegleitscheinEinstellungen },
  { pfad: 'vorlagen', label: 'Vorlagen-Texte', icon: IconTemplate, komponente: VorlagenEinstellungen },
  { pfad: 'sicherung', label: 'Sicherung', icon: IconDatabaseExport, komponente: SicherungEinstellungen },
  { pfad: 'zugaenge', label: 'Zugänge', icon: IconKey, komponente: ZugaengeEinstellungen },
  { pfad: 'werkzeuge', label: 'Werkzeuge', icon: IconTool, komponente: WerkzeugeEinstellungen },
  { pfad: 'audit', label: 'Audit-Log', icon: IconHistory, komponente: AuditEinstellungen },
  { pfad: 'dubletten', label: 'Dubletten', icon: IconCopy, komponente: DublettenEinstellungen },
  { pfad: 'papierkorb', label: 'Papierkorb', icon: IconTrash, komponente: PapierkorbEinstellungen },
  { pfad: 'm365', label: 'Microsoft 365', icon: IconMail, komponente: M365Einstellungen },
  { pfad: 'freigaben', label: 'Aktionen nach außen', icon: IconShieldLock, komponente: FreigabenEinstellungen },
  { pfad: 'anleitungen', label: 'Anleitungen', icon: IconBook, komponente: AnleitungenEinstellungen },
];
