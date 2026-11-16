; Register an available handler. Windows owns the user's default selection.
!ifndef ORIA_VNC_SCHEME
  !define ORIA_VNC_SCHEME "vnc"
!endif
!macro NSIS_HOOK_POSTINSTALL
  ; Settings lists link types only if the scheme itself is a URL protocol.
  ; This shared marker has no open command and can serve other VNC clients.
  Push $0
  ClearErrors
  ReadRegStr $0 HKCR "${ORIA_VNC_SCHEME}" "URL Protocol"
  ${If} ${Errors}
    WriteRegStr SHCTX "Software\Classes\${ORIA_VNC_SCHEME}" "URL Protocol" ""
  ${EndIf}
  Pop $0
  WriteRegStr SHCTX "Software\Classes\${PRODUCTNAME}.VNC" "" "${PRODUCTNAME} VNC"
  WriteRegStr SHCTX "Software\Classes\${PRODUCTNAME}.VNC" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\${PRODUCTNAME}.VNC\DefaultIcon" "" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\Classes\${PRODUCTNAME}.VNC\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities" "ApplicationDescription" "${PRODUCTNAME} VNC"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities" "ApplicationIcon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\URLAssociations" "${ORIA_VNC_SCHEME}" "${PRODUCTNAME}.VNC"
  WriteRegStr SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}" "Software\${PRODUCTNAME}\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; An older copy may be uninstalled after another directory took ownership.
  Push $0
  ReadRegStr $0 SHCTX "Software\Classes\${PRODUCTNAME}.VNC\shell\open\command" ""
  ${If} $0 == '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
    ReadRegStr $0 SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}"
    ${If} $0 == "Software\${PRODUCTNAME}\Capabilities"
      DeleteRegValue SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}"
    ${EndIf}
    DeleteRegKey SHCTX "Software\${PRODUCTNAME}\Capabilities"
    DeleteRegKey /ifempty SHCTX "Software\${PRODUCTNAME}"
    DeleteRegKey SHCTX "Software\Classes\${PRODUCTNAME}.VNC"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
  ${EndIf}
  Pop $0
!macroend
