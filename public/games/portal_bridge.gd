extends Node
## PortalBridge - sends game results to the MANAS Care Portal.
##
## 1. Copy this file into the Godot project.
## 2. Project > Project Settings > Globals (Autoload): Path res://portal_bridge.gd, Name PortalBridge.
## 3. Call it where the game saves its results (see README.md in this folder).
##
## It does nothing unless the game runs as a Web export inside the portal,
## so desktop and Android builds behave exactly as before.


## One finished session or trip. Haat Bazaar sends each completed trip.
func send_session(game: String, data: Dictionary) -> void:
	_post("session", game, data)


## One small event, such as a single tap. Tator Gatha sends each tap;
## the portal groups them into a session when the game is closed.
func send_event(game: String, data: Dictionary) -> void:
	_post("event", game, data)


func _post(kind: String, game: String, data: Dictionary) -> void:
	if not OS.has_feature("web"):
		return
	var message := {"source": "manas-game", "type": kind, "game": game, "payload": data}
	# JSON is valid JavaScript, so the message can be passed straight to postMessage.
	JavaScriptBridge.eval("window.parent.postMessage(%s, window.location.origin);" % JSON.stringify(message), true)
