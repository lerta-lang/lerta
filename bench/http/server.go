// Serves the requests of load.lerta at a free port of 127.0.0.1, which it prints first.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"runtime"
)

type Item struct {
	ID   int      `json:"id"`
	Name string   `json:"name"`
	Tags []string `json:"tags"`
}

func main() {
	// Runs Go code on one thread, as the servers in Lerta and Node.js run their event loops on one.
	runtime.GOMAXPROCS(1)
	http.HandleFunc("/hello", func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "Hello, world!")
	})
	http.HandleFunc("/json", func(w http.ResponseWriter, r *http.Request) {
		body, _ := json.Marshal(Item{ID: 1, Name: "lerta", Tags: []string{"fast", "small"}})
		w.Write(body)
	})
	http.HandleFunc("/echo", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		w.Write(body)
	})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	fmt.Println(listener.Addr().(*net.TCPAddr).Port)
	panic(http.Serve(listener, nil))
}
