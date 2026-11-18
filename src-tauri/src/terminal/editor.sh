# Embedded with Unix line endings and sourced in this session's interactive shell.
# All payloads are data. NUL separates fields inside base64-encoded OSC replies.
__oria_emit() {
    local kind=$1 revision=$2 encoded=
    shift 2
    if [ "$#" -gt 0 ]; then encoded=$(printf '%s\0' "$@" | command base64 | command tr -d '\r\n'); fi
    printf '\033]6973;%s;%s;%s;%s\007' "$__oria_token" "$kind" "$revision" "$encoded"
}
__oria_paths() {
    local base=$1 prefix=$2 mode=$3 item name
    [ -d "$base" ] && [ -r "$base" ] && [ -x "$base" ] || return 1
    if [ -n "${ZSH_VERSION-}" ]; then setopt localoptions nullglob; fi
    for item in "$base"/"$prefix"*; do
        [ -e "$item" ] || [ -L "$item" ] || continue
        name=${item##*/}
        if [ -d "$item" ]; then name=$name/
        elif [ "$mode" != files ]; then continue
        fi
        __oria_items+=("$name")
        [ "${#__oria_items[@]}" -lt 512 ] || break
    done
    return 0
}
# Load only entries already admitted by the remote user's own shell history.
__oria_load_history() {
    local number record total=0 n=0
    local -a entries
    [ -n "${HISTFILE-}" ] && [ "$HISTFILE" != /dev/null ] || return 0
    if [ -n "${ZSH_VERSION-}" ]; then
        [ "${SAVEHIST:-0}" -gt 0 ] || return 0
        zmodload zsh/parameter 2>/dev/null || return 0
        for number in ${(Onk)history}; do
            record=${history[$number]}
            [ -n "$record" ] || continue
            total=$(( total + ${#record} ))
            [ "$total" -le 65536 ] || break
            entries+=("$record"); n=$((n+1)); [ "$n" -lt 200 ] || break
        done
    else
        [[ -o history ]] || return 0
        record=$(HISTTIMEFORMAT= builtin history 1)
        [[ $record =~ ^[[:space:]]*([0-9]+) ]] || return 0
        number=${BASH_REMATCH[1]}
        while [ "$number" -gt 0 ] && [ "$n" -lt 200 ]; do
            record=$(builtin history -p '!'"$number" 2>/dev/null) || break
            total=$(( total + ${#record} )); [ "$total" -le 65536 ] || break
            entries+=("$record"); n=$((n+1)); number=$((number-1))
        done
    fi
    __oria_emit history 0 "${entries[@]}"
}
__oria_prompt() {
    local previous=$? saved request op seq payload value base prefix name eligible=0 last
    local draft= point=0
    local -a __oria_items
    [ -t 0 ] && [ -t 1 ] || return "$previous"
    if [ "${__oria_ps1+x}" ]; then
        [ "$PS1" != "$__oria_native_prompt" ] || PS1=$__oria_ps1
        unset __oria_ps1 __oria_native_prompt
    fi
    if [ -n "${__oria_restore_promptsp-}" ]; then
        setopt promptsp
        unset __oria_restore_promptsp
    fi
    if [ -n "${__oria_eol_mark-}" ]; then
        if [ "${PROMPT_EOL_MARK-}" = "$__oria_eol_mark" ]; then
            if [ "$__oria_had_eol" = x ]; then PROMPT_EOL_MARK=$__oria_saved_eol; else unset PROMPT_EOL_MARK; fi
        fi
        unset __oria_eol_mark __oria_saved_eol __oria_had_eol
    fi
    case $- in *x*) return "$previous" ;; esac
    saved=$(command stty -g) || return "$previous"
    if [ -n "${__oria_submitted-}" ]; then
        if [ -n "${ZSH_VERSION-}" ]; then last=$(fc -ln -1 2>/dev/null)
        else
            last=$(HISTTIMEFORMAT= builtin history 1)
            if [[ $last =~ ^[[:space:]]*[0-9]+[[:space:]][[:space:]](.*)$ ]]; then last=${BASH_REMATCH[1]}; else last=; fi
        fi
        if [ "$last" = "$__oria_submitted" ] || [ "$last" = "$(printf '\t')$__oria_submitted" ]; then eligible=1; fi
        if [ "$eligible" = 1 ] && [ -n "${HISTFILE-}" ] && [ "$HISTFILE" != /dev/null ]; then
            if [ -n "${ZSH_VERSION-}" ]; then
                [ "${SAVEHIST:-0}" -le 0 ] || builtin fc -AI 2>/dev/null
            elif [[ -o history ]] && [ "${HISTSIZE:-0}" != 0 ] && [ "${HISTFILESIZE:-1}" != 0 ]; then
                builtin history -a "$HISTFILE" 2>/dev/null
            fi
        fi
        unset __oria_submitted
    fi
    command stty -echo -icanon -isig min 1 time 0 || return "$previous"
    local venv= conda= pyenv= nix=
    if [ -n "${VIRTUAL_ENV-}" ]; then
        venv=${VIRTUAL_ENV%/}; venv=${VIRTUAL_ENV_PROMPT:-${venv##*/}}
    fi
    if [ -n "${CONDA_DEFAULT_ENV-}" ]; then conda=${CONDA_DEFAULT_ENV##*/}; fi
    if [ -z "$venv$conda" ]; then pyenv=${PYENV_VERSION-}; fi
    if [ -n "${IN_NIX_SHELL-}" ]; then nix=nix-shell; fi
    __oria_emit ready 0 "$PWD" "$HOME" "$eligible" "$venv" "$conda" "$pyenv" "$nix"
    printf '\033[3J\033[2J\033[H'
    if [ -z "${__oria_history_loaded-}" ]; then
        __oria_history_loaded=1
        __oria_load_history
    fi
    while IFS= read -r request; do
        case "$request" in '#oria '*) ;; *) continue ;; esac
        request=${request#* }; op=${request%% *}; request=${request#* }
        seq=${request%% *}; payload=${request#* }
        case "$seq" in ''|*[!0-9]*) continue ;; esac
        # Sentinel preserves trailing newlines during command substitution.
        value=$(printf %s "$payload" | command base64 -d 2>/dev/null && printf .) || continue
        value=${value%.}
        __oria_items=()
        case "$op" in
            edit)
                point=${value%% *}; draft=${value#* }
                __oria_emit edited "$seq" "$point"
                ;;
            logout)
                command stty "$saved"
                builtin exit
                ;;
            run|raw)
                __oria_ps1=$PS1
                local native=$PS1 marker
                if [ "$op" = run ]; then
                    draft=$value
                    __oria_submitted=$draft
                    native='$ '
                fi
                if [ -n "${ZSH_VERSION-}" ]; then
                    # Snapshot run and raw output before zsh paints its next prompt's padding.
                    __oria_saved_eol=${PROMPT_EOL_MARK-}
                    __oria_had_eol=${PROMPT_EOL_MARK+x}
                    __oria_eol_mark="%{$(__oria_emit outputEnd "$seq")%}"
                    PROMPT_EOL_MARK=$__oria_eol_mark
                fi
                marker=$(__oria_emit release "$seq")
                if [ -n "${ZSH_VERSION-}" ]; then __oria_native_prompt="$native%{$marker%}"
                else __oria_native_prompt="$native\[$marker\]"; fi
                PS1=$__oria_native_prompt
                command stty "$saved"
                return "$previous"
                ;;
            cd)
                if builtin cd -- "$value" >/dev/null 2>&1; then __oria_emit cwd "$seq" "$PWD"
                else __oria_emit error "$seq"; fi
                ;;
            list)
                if __oria_paths "$value" '' dirs; then __oria_emit list "$seq" "${__oria_items[@]}"
                else __oria_emit error "$seq"; fi
                ;;
            dirs|files)
                case "$value" in */*) base=${value%/*}; prefix=${value##*/}; base=${base:-/} ;; *) base=.; prefix=$value ;; esac
                case "$base" in '~') base=$HOME ;; '~/'*) base=$HOME/${base#\~/} ;; esac
                __oria_paths "$base" "$prefix" "$op"
                __oria_emit matches "$seq" "${__oria_items[@]}"
                ;;
            commands)
                if [ -n "${ZSH_VERSION-}" ]; then
                    for name in ${(k)commands} ${(k)aliases} ${(k)builtins} ${(k)functions}; do
                        case "$name" in "$value"*) __oria_items+=("$name") ;; esac
                        [ "${#__oria_items[@]}" -lt 256 ] || break
                    done
                else
                    while IFS= read -r name; do
                        __oria_items+=("$name"); [ "${#__oria_items[@]}" -lt 256 ] || break
                    done < <(compgen -A command -- "$value")
                fi
                __oria_emit matches "$seq" "${__oria_items[@]}"
                ;;
        esac
    done
    command stty "$saved"
    return "$previous"
}
if command -v base64 >/dev/null && command -v stty >/dev/null; then
    # Keep explicit aliases, functions and color preferences. Auto color applies only on a tty.
    if [ -z "${NO_COLOR+x}${CLICOLOR+x}" ] && ! alias ls >/dev/null 2>&1 && ! typeset -f ls >/dev/null 2>&1; then
        export CLICOLOR=1
        if command ls --color=auto -d . >/dev/null 2>&1; then alias ls='ls --color=auto'; fi
    fi
    if [ -n "${ZSH_VERSION-}" ]; then
        # The first precmd archives the startup banner. Suppress both zsh's EOL
        # glyph and its margin padding, which can wrap at a different xterm width.
        if [[ -o promptsp ]]; then
            __oria_restore_promptsp=1
            unsetopt promptsp
        fi
        precmd_functions+=(__oria_prompt)
    elif [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == 'declare -a '* ]]; then
        PROMPT_COMMAND+=(__oria_prompt)
    else
        PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND$'\n'}__oria_prompt"
    fi
fi
