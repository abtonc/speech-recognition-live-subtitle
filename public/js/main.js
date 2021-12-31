var socket = io();

let container = document.getElementById("container");

let clearEvent;

socket.on("subtitleUpdate", (subtitle) => {
    document.getElementById("subtitle").innerText = subtitle ? subtitle : "";
    clearTimeout(clearEvent);
    clearEvent = setTimeout(() => {
        document.getElementById("subtitle").innerText = "";
    }, 3000);
});

socket.on("moveSubtitle", (upDownValue) => {
    container.className = upDownValue == 1 ? "container-top" : "container-bottom";
});