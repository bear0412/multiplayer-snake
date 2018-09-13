var express = require('express');
var app = express();
var serv = require('http').Server(app);
var colors = require('colors/safe');
var middleware = require('socketio-wildcard')();


var debug = typeof v8debug === 'object' || /--debug/.test(process.execArgv.join(' '));

console.log(colors.green("[Snake] Starting server..."));
app.get('/',function(req, res) {
	res.sendFile(__dirname + '/client/index.html');
});
app.use('/client',express.static(__dirname + '/client'));

//---------- Server settings ----------
var MAX_SOCKET_ACTIVITY_PER_SECOND = 1000;
var fps = 5;

var MAP_WIDTH = 500;
var MAP_HEIGHT = 500;

var MAX_FOOD = 1500;
//-------------------------------------

var port = process.env.PORT || 80;
if(process.env.PORT == undefined) {
	console.log(colors.blue("[Snake] No port defined using default (80)"));
}

serv.listen(port);
var io = require("socket.io")(serv, {});
io.use(middleware);

console.log(colors.green("[Snake] Socket started on port " + port));

var SOCKET_LIST = {};
var SOCKET_ACTIVITY = {};
var PLAYER_LIST = {};
var FOOD_LIST = {};

var Food = function(id, x, y) {
	var self = {
		id:id,
		color:Math.floor(Math.random() * 360),
		x:x,
		y:y
	}
	return self;
}

// Directions: 0 = up (-y), 1 = right (+x), 2 = down = (+y), 3 = left (-x)
var Player = function(id) {
	var self = {
		id:id,
		direction:0,
		lastDirection:0,
		x:MAP_WIDTH / 2,
		y:MAP_HEIGHT / 2,
		score:0,
		tailBlocks:[],
		inGame:false,
		name:"unnamed",
		color:0
	}

	self.update = function() {
		self.tailBlocks.unshift(new Tail(self.x, self.y, self.id, self.color));
		while(self.score + 2 < self.tailBlocks.length) {
			delete self.tailBlocks.pop();
		}
		switch(self.direction) {
			case 0:
				self.y--;
				break;
			case 1:
				self.x++;
				break;
			case 2:
				self.y++;
				break;
			case 3:
				self.x--;
				break;
			default:
			// Invalid direction
				console.log("Invalid direction for player " + self.id + ". Direction reset to 0");
				self.direction = 0;
				break;
		}
		self.lastDirection = self.direction;

		if(self.x <= 0 || self.x >= MAP_WIDTH || self.y <= 0 || self.y >= MAP_WIDTH) {
			self.die();
			return;
		}

		for(let p in PLAYER_LIST) {
			let player = PLAYER_LIST[p];
			for(let t in player.tailBlocks) {
				let pTail = player.tailBlocks[t];
				if(self.x == pTail.x && self.y == pTail.y) {
					self.die();
					player.score+=(self.score / 2);
					return;
				}
			}
		}

		for(let f in FOOD_LIST) {
			let food = FOOD_LIST[f];
			if(self.x == food.x && self.y == food.y) {
				self.score++;
				delete FOOD_LIST[food.id];
			}
		}
	}

	self.die = function() {
		self.inGame = false;
		self.deleteTail();
	}

	self.deleteTail = function() {
		for (let i = self.tailBlocks.length; i > 0; i--) {
			self.tailBlocks.pop();
		}
	}

	self.spawn = function() {
		self.x = Math.floor(Math.random() * (MAP_WIDTH - 20)) + 10;
		self.y = Math.floor(Math.random() * (MAP_WIDTH - 20)) + 10;
		self.color = self.y = Math.floor(Math.random() * 360);
		self.score = 0;
		self.inGame = true;
	}
	return self;
}

var Tail = function(x, y, playerId, color) {
	var self = {
		x:x,
		y:y,
		playerId:playerId,
		color:color
	}
	return self;
}

function update() {
	let playerPack = [];
	let tailPack = [];
	let foodPack = [];

	for (let p in PLAYER_LIST) {
		let player = PLAYER_LIST[p];

		if(player.inGame) {
			player.update();
			//console.log(player.id + " x: " + player.x + " y: " + player.y);
			playerPack.push({
				id:player.id,
				x:player.x,
				y:player.y,
				name:player.name,
				color:player.color
			});
			for(let t in player.tailBlocks) {
				let tail = player.tailBlocks[t];
				tailPack.push({
					x:tail.x,
					y:tail.y,
					color:tail.color
					//player:player.id
				});
			}
		}
	}

	for(let f in FOOD_LIST) {
		let food = FOOD_LIST[f];
		foodPack.push({
			x:food.x,
			y:food.y,
			color:food.color
		});
	}

	for(let s in SOCKET_LIST) {
		SOCKET_LIST[s].emit("gamestate" ,{
			players:playerPack,
			playerTails:tailPack,
			food:foodPack
		});
	}
}

setInterval(function() {
	update();
}, 1000 / fps);

setInterval(function() {
	if(FOOD_LIST.length < MAX_FOOD) {
		spawnFood();
	}
}, 500);

for (let i = 0; i < MAX_FOOD; i++) {
	spawnFood();
}

function spawnFood() {
	let id = Math.random();
	FOOD_LIST[id] = new Food(id, Math.floor(Math.random() * (MAP_WIDTH - 4)) + 2, Math.floor(Math.random() * (MAP_WIDTH - 4)) + 2);
}

function spawnPlayer(id) {
	try {
		PLAYER_LIST[id].spawn();
		SOCKET_LIST[id].emit("spawn", {x:PLAYER_LIST[id].x, y:PLAYER_LIST[id].y})
	} catch(err) {
		if(debug) {
			throw err;
		}
	}
}

function disconnectSocket(id) {
	SOCKET_LIST[id].disconnect();
	delete SOCKET_LIST[id];
	delete SOCKET_ACTIVITY[id];
}

io.sockets.on("connection", function(socket) {
	socket.id = Math.random();
	if(SOCKET_ACTIVITY[socket.id] == undefined) {
		SOCKET_ACTIVITY[socket.id] = 0;
	}
	SOCKET_LIST[socket.id] = socket;
	let player = Player(socket.id);

	PLAYER_LIST[socket.id] = player;
	console.log(colors.cyan("[Snake] Socket connection with id " + socket.id));
	socket.emit("id", {
		id:socket.id
	});
	
	setTimeout(function() {spawnPlayer(socket.id)}, 500);

	socket.on("disconnect", function() {
		try {
			delete PLAYER_LIST[socket.id];
			console.log(colors.cyan("[Snake] Player with id " + socket.id + " disconnected"));
			disconnectSocket(socket.id);
		} catch(err) {
			if(debug) {
				throw err;
			}
		}
	});

	socket.on('keyPress',function(data){
		try {
			if(data.inputId === 'up' && player.lastDirection != 2)
				player.direction = 0;
			else if(data.inputId === 'right' && player.lastDirection != 3)
				player.direction = 1;
			else if(data.inputId === 'down' && player.lastDirection != 0)
				player.direction = 2;
			else if(data.inputId === 'left' && player.lastDirection != 1)
				player.direction = 3;
		} catch(err) {
			if(debug) {
				throw err;
			}
		}
	});

	socket.on("*", function(data) {
		try {
			SOCKET_ACTIVITY[socket.id]++;
			//console.log(data);
		} catch(err) {
			if(debug) {
				throw err;
			}
		}
	});
});

console.log(colors.green("[Snake] Server started "));
if(debug) {
	console.log("Running in debug mode");
}