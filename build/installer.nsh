; Boaty installer customisations (picked up by electron-builder from build/installer.nsh).

; By default electron-builder's uninstaller, which also runs during every update, deletes the whole
; install folder with everything in it. If someone installs Boaty into a folder that holds their own
; files, those files are lost. Remove only what Boaty itself installs, and remove the folder only
; when it ends up empty.
!macro customRemoveFiles
  SetOutPath $TEMP

  Delete "$INSTDIR\Boaty.exe"
  ; Left from before the rename (Birdy became Boaty).
  Delete "$INSTDIR\Birdy.exe"
  Delete "$INSTDIR\LICENSE.electron.txt"
  Delete "$INSTDIR\LICENSES.chromium.html"
  Delete "$INSTDIR\chrome_100_percent.pak"
  Delete "$INSTDIR\chrome_200_percent.pak"
  Delete "$INSTDIR\resources.pak"
  Delete "$INSTDIR\d3dcompiler_47.dll"
  Delete "$INSTDIR\dxcompiler.dll"
  Delete "$INSTDIR\dxil.dll"
  Delete "$INSTDIR\electron_wer.dll"
  Delete "$INSTDIR\ffmpeg.dll"
  Delete "$INSTDIR\libEGL.dll"
  Delete "$INSTDIR\libGLESv2.dll"
  Delete "$INSTDIR\vk_swiftshader.dll"
  Delete "$INSTDIR\vk_swiftshader_icd.json"
  Delete "$INSTDIR\vulkan-1.dll"
  Delete "$INSTDIR\icudtl.dat"
  Delete "$INSTDIR\snapshot_blob.bin"
  Delete "$INSTDIR\v8_context_snapshot.bin"

  Delete "$INSTDIR\locales\*.pak"
  RMDir "$INSTDIR\locales"

  Delete "$INSTDIR\resources\app.asar"
  RMDir /r "$INSTDIR\resources\app.asar.unpacked"
  Delete "$INSTDIR\resources\app-update.yml"
  Delete "$INSTDIR\resources\elevate.exe"
  RMDir "$INSTDIR\resources"

  Delete "$INSTDIR\${UNINSTALL_FILENAME}"
  ; Not /r: only removed when nothing else is in it.
  RMDir "$INSTDIR"
!macroend

; Birdy was renamed Boaty: remove the old app's shortcuts and program file when Boaty installs over it.
!macro customInstall
  Delete "$DESKTOP\Birdy.lnk"
  Delete "$SMPROGRAMS\Birdy.lnk"
  Delete "$INSTDIR\Birdy.exe"
!macroend
