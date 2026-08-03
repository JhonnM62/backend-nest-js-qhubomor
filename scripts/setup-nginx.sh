#!/bin/bash

# Script para configurar Nginx y SSL
# Basado en el script testeado de n8n, adaptado para ser independiente sin necesidad de plantillas externas.
# Uso: DOMAIN=your.domain.com PORT=8022 EMAIL=you@email.com bash setup-nginx.sh

set -e

if [ -z "$DOMAIN" ] || [ -z "$PORT" ] || [ -z "$EMAIL" ]; then
    echo "❌ Error: Las variables DOMAIN, PORT y EMAIL son requeridas"
    exit 1
fi

NGINX_CONF_PATH="/etc/nginx/sites-available/$DOMAIN"
NGINX_ENABLED_PATH="/etc/nginx/sites-enabled/$DOMAIN"

echo "🚀 Configurando Nginx para $DOMAIN en el puerto $PORT..."

if ! command -v nginx &> /dev/null || ! command -v certbot &> /dev/null; then
    echo "❌ Error: Nginx o Certbot no están instalados."
    exit 1
fi

echo "📝 Generando archivo de configuración de Nginx..."
sudo cat <<EOF > "$NGINX_CONF_PATH"
server {
    server_name $DOMAIN;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF
echo "✅ Archivo de configuración generado."

# Habilitar sitio
sudo ln -sf "$NGINX_CONF_PATH" "$NGINX_ENABLED_PATH"

if sudo nginx -t; then
    sudo systemctl reload nginx
    echo "✅ Nginx recargado con configuración inicial."
else
    echo "❌ Error en la configuración de Nginx."
    exit 1
fi

if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    echo "🔄 Certificado SSL ya existe. Renovando si es necesario..."
    sudo certbot renew --quiet
else
    echo "🔒 Obteniendo nuevo certificado SSL para $DOMAIN..."
    sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || echo "⚠️ Advertencia: Ocurrió un error leve al ejecutar Certbot o el certificado ya existe."
fi

# Configurar renovación automática de SSL
echo "⏰ Configurando renovación automática de SSL..."
(sudo crontab -l 2>/dev/null | grep -v "certbot renew" || true; echo "0 12 * * * /usr/bin/certbot renew --quiet") | sudo crontab -

echo "🎉 ¡Configuración de Nginx y SSL completada exitosamente!"
echo "   - Dominio: https://$DOMAIN"
echo "   - Puerto interno: $PORT"
echo "   - Email de Let's Encrypt: $EMAIL"
