rm uninstall.sh
echo '#!/bin/bash
rm -rf ~/.local/bin/5mind-desktop
rm ~/.local/share/applications/5mind.desktop
rm ~/.local/share/icons/hicolor/256x256/apps/5mind.png
gtk-update-icon-cache ~/.local/share/icons/hicolor -f || true
echo "5Mind uninstalled."
' > uninstall.sh
chmod +x uninstall.sh
