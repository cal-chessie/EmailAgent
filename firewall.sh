# UFW firewall rules for Solar Agent server

# Enable UFW
sudo ufw enable

# Allow SSH (change port if non-default)
sudo ufw limit 22/tcp

# Allow HTTPS from anywhere (dashboard + agent traffic)
sudo ufw allow 443/tcp

# Allow HTTP for Let's Encrypt certificate challenges
sudo ufw allow 80/tcp

# Allow SSH for management
sudo ufw allow 2222/tcp  # if using custom SSH port

# Deny all other incoming by default
sudo ufw default deny incoming

# Allow all outgoing
sudo ufw default allow outgoing

# Status check
sudo ufw status verbose

# === For cloud VMs (DigitalOcean/Linode/Vultr) ===
# Replace eth0 with your primary interface (check with: ip -o -4 addr show)
# Allow dashboard only from specific IP ranges (e.g. office)

# From office IP only (replace 1.2.3.4 with your office IP)
# sudo ufw allow from 1.2.3.4/32 to any port 443

# === Fail2ban for SSH brute force protection ===
sudo apt install fail2ban -y
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# === UFW automation script ===
cat << 'EOF' | sudo tee /usr/local/bin/firewall-setup.sh
#!/bin/bash
set -e

echo "[Firewall] Setting up UFW rules..."

# Default policies
ufw --force default deny incoming
ufw --force default allow outgoing

# SSH with rate limiting (prevent brute force)
ufw limit 22/tcp comment 'SSH rate limit'

# HTTPS (dashboard + agent)
ufw allow 443/tcp comment 'HTTPS'

# HTTP (Let's Encrypt / certbot)
ufw allow 80/tcp comment 'HTTP for ACME'

# Enable
ufw --force enable

echo "[Firewall] Done. Status:"
ufw status verbose
EOF

sudo chmod +x /usr/local/bin/firewall-setup.sh