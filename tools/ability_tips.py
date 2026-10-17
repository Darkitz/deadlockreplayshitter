"""In-game style tooltips for abilities and items (web/data/tips.json), built from the same
abilities.vdata + localization as assets.json.

Per class name:
  head      [[label, value]]           cooldown, duration, range, charges + the ability's header stats
  sections  [{area, desc, main, basic}]  area: active | passive | innate | None
            main  [[label, value, scale]]  the big stat boxes; scale = [multiplier, stat] or None
            basic [[label, value]]         the smaller lines under them
  tiers     [desc, desc, desc]         hero ability upgrades (cost 1 / 2 / 5 ability points)

Descriptions are reduced to escaped text plus a few tags the site styles: <b class="hl|spirit|
weapon|vit|dim">, <i> and <br>. Everything else from the game's markup is dropped.
"""
import html
import re

UNITS = {"EDisplayUnit_Meters": "m", "EDisplayUnit_MetersPerSecond": "m/s"}
# which stat a property's value grows with (m_eSpecificStatScaleType); the site shows "×1.8 spirit"
SCALE_STAT = {
    None: "spirit", "ETechPower": "spirit", "ELevelUpBoons": "boon", "ELightMeleeDamage": "light melee",
    "EHeavyMeleeDamage": "heavy melee", "EBaseWeaponDamageIncrease": "weapon damage", "EWeaponDamageScale": "weapon damage",
    "EWeaponPower": "weapon damage", "EBulletDamage": "bullet damage", "EHealingOutput": "healing",
}
SPAN = {"highlight": "hl", "highlight_special": "hl", "highlight_courage": "hl", "highlight_spirit": "spirit",
        "highlight_weapon": "weapon", "highlight_vitality": "vit", "diminish": "dim", "small_diminish": "dim"}
AREA = {"EArea_Active": "active", "EArea_Passive": "passive", "EArea_Innate": "innate"}
HEAD = [("AbilityCooldown", "Cooldown"), ("AbilityDuration", "Duration"), ("AbilityCastRange", "Range"),
        ("AbilityCharges", "Charges"), ("AbilityChannelTime", "Channel")]
HEAD_PROPS = {p for p, _ in HEAD}


def _num(v):
    try:
        return float(re.sub(r"[a-z%]+$", "", str(v).strip()))
    except ValueError:
        return None


def _fmt(x):
    return f"{x:.2f}".rstrip("0").rstrip(".") if x is not None else ""


class Tips:
    def __init__(self, loc):
        self.loc = loc

    def label(self, prop, p):
        tok = (p.get("m_strLocTokenOverride") or "").lstrip("#").lower() if isinstance(p, dict) else ""
        return (self.loc.get(tok) or self.loc.get(f"{prop.lower()}_label")
                or re.sub(r"(?<=[a-z])(?=[A-Z])", " ", prop))

    def value(self, prop, p, raw=None, signed=False):
        """'+20%', '-6s', '15m' — the game's prefix / postfix for that property"""
        raw = (p.get("m_strValue") if isinstance(p, dict) else p) if raw is None else raw
        x = _num(raw)
        if x is None:
            return None
        lo = prop.lower()
        post = self.loc.get(f"{lo}_postfix")
        if post is None:
            unit = re.search(r"[a-z%]+$", str(raw).strip())
            post = (unit.group(0) if unit else "") or UNITS.get(p.get("m_eDisplayUnits") if isinstance(p, dict) else "", "")
        pre = self.loc.get(f"{lo}_prefix", "")
        if "{s:sign}" in pre or signed:
            pre = "+" if x > 0 else ""
        elif pre == "-" and x < 0:
            pre = ""
        return f"{pre}{_fmt(x)}{post}"

    @staticmethod
    def shown(p):
        """the game hides zero / disabled values"""
        if not isinstance(p, dict):
            return False
        raw = p.get("m_strValue")
        x = _num(raw)
        if x is None or x == 0:
            return False
        dis = _num(p.get("m_strDisableValue"))
        return dis is None or x != dis

    @staticmethod
    def scale(p):
        f = p.get("m_subclassScaleFunction") if isinstance(p, dict) else None
        if not isinstance(f, dict) or not f.get("m_flStatScale"):
            return None
        stat = f.get("m_eSpecificStatScaleType")
        return [round(float(f["m_flStatScale"]), 3), SCALE_STAT.get(stat, re.sub(r"^E", "", stat or "").lower())]

    def text(self, key, props, subst=None):
        """localized description -> safe markup; {s:Prop} filled from `subst` (or the property)"""
        s = self.loc.get(key.lstrip("#").lower())
        if not s:
            return None
        s = s.replace('\\"', '"').replace("\\n", "\n")
        out, pos = [], 0
        tag = re.compile(r"<br\s*/?>|<span class=\"([^\"]*)\">|</span>|<b>|</b>|<i>|</i>|<[^>]+>"
                         r"|\{g:citadel_inline_attribute:'([^']+)'\}|\{s:(\w+)\}|\{\w(?::\w+)*\}")
        stack = []
        for m in tag.finditer(s):
            out.append(html.escape(s[pos:m.start()], quote=False))
            pos = m.end()
            t = m.group(0)
            if t.startswith("<br"):
                out.append("<br>")
            elif m.group(1) is not None:
                cls = SPAN.get(m.group(1).split()[0])
                stack.append("</b>" if cls else "")
                out.append(f'<b class="{cls}">' if cls else "")
            elif t == "</span>":
                out.append(stack.pop() if stack else "")
            elif t in ("<b>", "</b>", "<i>", "</i>"):
                out.append(t)
            elif m.group(2):
                name = m.group(2)
                word = self.loc.get(f"inlineattribute_{name.lower()}") or name
                cls = "spirit" if "spirit" in name.lower() else "weapon" if re.search("weapon|bullet", name, re.I) else "hl"
                out.append(f'<b class="{cls}">{html.escape(word)}</b>')
            elif m.group(3):
                prop = m.group(3)
                if subst is not None:
                    v = subst.get(prop)
                    out.append(html.escape(_fmt(_num(v)) if v is not None and _num(v) is not None else ""))
                else:
                    p = props.get(prop)
                    x = _num(p.get("m_strValue") if isinstance(p, dict) else p)
                    out.append(_fmt(x) if x is not None else "")
        out.append(html.escape(s[pos:], quote=False))
        out.extend(stack)
        res = re.sub(r"(<br>\s*)+$", "", "".join(out).strip())
        return res or None

    def prop_list(self, names, props, main=False):
        rows = []
        for n in names:
            status = None
            if isinstance(n, dict):
                status = n.get("m_strStatusEffectValue")
                n = n.get("m_strImportantProperty") or n.get("m_strPropertyName")
            if not n:
                continue
            key = status or n
            p = props.get(key)
            if not self.shown(p) or key in HEAD_PROPS:
                continue
            row = [self.label(key, p), self.value(key, p)]
            if main:
                row.append(self.scale(p))
            rows.append(row)
        return rows

    def build(self, key, a):
        props = {k: v for k, v in (a.get("m_mapAbilityProperties") or {}).items() if isinstance(v, dict)}
        head = []
        for prop, name in HEAD:
            p = props.get(prop)
            if self.shown(p) and not (prop == "AbilityCharges" and (_num(p.get("m_strValue")) or 0) <= 1):
                head.append([name, self.value(prop, p)])
        sections = []
        details = a.get("m_AbilityTooltipDetails") or {}
        for prop in details.get("m_vecAdditionalHeaderProperties") or []:
            if self.shown(props.get(prop)):
                head.append([self.label(prop, props[prop]), self.value(prop, props[prop])])
        for sec in details.get("m_vecAbilityInfoSections") or []:
            main = [x for blk in sec.get("m_vecAbilityPropertiesBlock") or [] for x in blk.get("m_vecAbilityProperties") or []]
            sections.append({"area": None, "desc": self.text(sec.get("m_strLocString") or "", props),
                             "main": self.prop_list(main, props, True),
                             "basic": self.prop_list(sec.get("m_vecBasicProperties") or [], props)})
        for sec in a.get("m_vecTooltipSectionInfo") or []:
            for at in sec.get("m_vecSectionAttributes") or []:
                main = (at.get("m_vecImportantAbilityProperties") or []) + (at.get("m_vecElevatedAbilityProperties") or [])
                sections.append({"area": AREA.get(sec.get("m_eAbilitySectionType")),
                                 "desc": self.text(at.get("m_strLocString") or "", props),
                                 "main": self.prop_list(main, props, True),
                                 "basic": self.prop_list(at.get("m_vecAbilityProperties") or [], props)})
        if not any(sec["desc"] for sec in sections):
            desc = self.text(f"{key}_desc", props)
            if desc:
                at = next((sec for sec in sections if sec["area"] in ("active", "passive")), None)
                if at:
                    at["desc"] = desc
                else:
                    sections.insert(0, {"area": None, "desc": desc, "main": [], "basic": []})
        tiers = []
        if a.get("m_eAbilityType") != "EAbilityType_Item":
            for i, up in enumerate(a.get("m_vecAbilityUpgrades") or []):
                bonus = {u.get("m_strPropertyName"): u.get("m_strBonus") for u in up.get("m_vecPropertyUpgrades") or []}
                # no localized line (some tiers only change numbers): "+10s Duration"
                tiers.append(self.text(f"{key}_t{i + 1}_desc", props, bonus) or "<br>".join(
                    f"{self.value(k, props.get(k, {}), v, signed=True)} {self.label(k, props.get(k))}"
                    for k, v in bonus.items() if k and _num(v) is not None))
        sections = [s for s in sections if s["desc"] or s["main"] or s["basic"]]
        if not (sections or tiers):
            return None
        tip = {"head": head, "sections": sections}
        if any(tiers):
            tip["tiers"] = tiers
        return tip


def build_tips(abilities_kv, loc, keep):
    """tips for every class name in `keep` (the abilities / items the site shows)"""
    t = Tips(loc)
    out = {}
    for key in sorted(keep):
        a = abilities_kv.get(key)
        if isinstance(a, dict):
            tip = t.build(key, a)
            if tip:
                out[key] = tip
    return out
