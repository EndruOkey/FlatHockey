# Nasazení na Oracle Cloud VPS

FlatHockey je Node.js server (Express servíruje `public/` + socket.io dělá WebRTC
signaling). Hra běží P2P mezi prohlížeči; server jen spojí dva hráče do místnosti.

## Co potřebuješ
- Oracle Cloud VM (Ubuntu) s veřejnou IP a SSH přístupem.
- Otevřený port v **OBOU** firewallech (viz krok 3 — to je nejčastější chyba).
- (Doporučeno) doménu pro HTTPS. WebRTC v prohlížečích spolehlivě jede jen v
  „secure contextu" (HTTPS). Přes čisté `http://IP:3000` to může fungovat pro
  testování, ale kamarádům to nemusí navázat spojení.

---

## 1. Připoj se a nainstaluj Node
```bash
ssh ubuntu@TVOJE_IP

# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v   # ověř >=18
```
> Oracle Linux místo Ubuntu? Použij `sudo dnf install -y nodejs git` a v
> `deploy/hockey.service` změň `User=ubuntu` na `User=opc`.

## 2. Naklonuj a nainstaluj
```bash
cd ~
git clone https://github.com/EndruOkey/FlatHockey.git
cd FlatHockey
git checkout gameplay-movement-rework   # nebo main, až to mergneš
npm install --omit=dev
```

Rychlý test (Ctrl+C ukončí):
```bash
PORT=3000 node server.js   # → listening on :3000
```

## 3. Otevři firewall — POZOR, Oracle má dvě vrstvy ⚠️
**a) Cloud (Security List / NSG)** — ve webové konzoli Oracle:
Networking → VCN → Subnet → Security List → **Add Ingress Rule**
- Source CIDR `0.0.0.0/0`, IP Protocol `TCP`, Destination Port `3000`
  (a `80` + `443`, pokud půjdeš přes Caddy/HTTPS).

**b) Lokální firewall na VM** (Oracle image blokují vše kromě SSH):
```bash
# Ubuntu (iptables)
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```
Teď zkus `http://TVOJE_IP:3000` v prohlížeči.

## 4. Ať to běží napořád (systemd)
```bash
sudo cp ~/FlatHockey/deploy/hockey.service /etc/systemd/system/
# zkontroluj User a WorkingDirectory v souboru
sudo systemctl daemon-reload
sudo systemctl enable --now hockey
sudo systemctl status hockey      # běží?
journalctl -u hockey -f           # logy
```
Po `git pull` restartuj: `sudo systemctl restart hockey`.

---

## 5. HTTPS přes doménu (doporučeno) — Caddy
Nasměruj doménu (A záznam) na IP serveru, pak:
```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy

# uprav doménu v deploy/Caddyfile, pak:
sudo cp ~/FlatHockey/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl restart caddy
```
Caddy si sám vyřídí Let's Encrypt certifikát. App nech na PORT=3000, Caddy ji
vystaví na `https://tvoje-domena` (port 443). V cloud firewallu měj otevřené 80+443.

> **Nemáš doménu?** Použij `nip.io` (viz komentář v `deploy/Caddyfile`) nebo
> **Cloudflare Tunnel** — dá HTTPS i bez otevírání portů (řeší i krok 3).

## Řešení potíží
- Stránka se nenačte → skoro vždy krok 3 (jeden z firewallů). Ověř oba.
- Stránka jede, ale hráči se nespojí → chybí HTTPS (krok 5), nebo přísný NAT.
  Při přísném NATu je potřeba TURN server (zatím máme jen STUN v `public/js/net.js`).
