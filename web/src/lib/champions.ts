// Riot's match data names champions by their internal key ("TwistedFate",
// "Chogath", "MonkeyKing"). This turns a key into the name players know.
// Keys that a space between words can't fix are listed; everything else is
// split at its capitals. Already-friendly names pass through unchanged.
const irregular: Record<string, string> = {
  AurelionSol: 'Aurelion Sol',
  Belveth: "Bel'Veth",
  Chogath: "Cho'Gath",
  DrMundo: 'Dr. Mundo',
  FiddleSticks: 'Fiddlesticks',
  JarvanIV: 'Jarvan IV',
  Kaisa: "Kai'Sa",
  KSante: "K'Sante",
  Khazix: "Kha'Zix",
  KogMaw: "Kog'Maw",
  Leblanc: 'LeBlanc',
  LeBlanc: 'LeBlanc',
  MonkeyKing: 'Wukong',
  Nunu: 'Nunu & Willump',
  RekSai: "Rek'Sai",
  Renata: 'Renata Glasc',
  Velkoz: "Vel'Koz",
}

export function championLabel(name: string | null | undefined): string {
  if (!name) return ''
  return irregular[name] ?? name.replace(/([a-z])([A-Z])/g, '$1 $2')
}
